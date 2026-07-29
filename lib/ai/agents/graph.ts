import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { completeObject } from "@/lib/ai/groq";
import {
  buildFactCheckPrompt,
  buildGenerationPrompt,
  buildSystemPrompt,
  draftGenSchema,
  factCheckSchema,
  type Plan,
} from "@/lib/ai/prompts";
import { critiqueContent, planPost, type GeneratedVariant } from "@/lib/ai/generate";
import { runResearcher } from "@/lib/ai/agents/researcher";
import { overallScore } from "@/lib/score";
import { withSpan } from "@/lib/ai/observability/trace";
import { ensureCheckpointerSetup, getCheckpointer } from "@/lib/ai/agents/checkpointer";
import type { PlatformId } from "@/lib/platforms";
import type { PersonaProfile } from "@/lib/persona-shared";
import type { RubricScore } from "@/lib/ai/rubric";
import type { Citation, ResearchBrief } from "@/lib/ai/agents/types";

// The v2 pipeline as a durable LangGraph StateGraph. Nodes reuse the existing
// agent functions verbatim (planPost, runResearcher, completeObject drafts,
// critiqueContent, fact-check) — LangGraph owns only control flow + state, which
// the Postgres checkpointer persists after every node. A crashed/timed-out run
// resumes from the last completed node (see resumeGenerationGraph) instead of
// restarting. Topology:
//   START ─▶ strategist ─┐
//   START ─▶ researcher ─┴▶ debate ─▶ (citations? factcheck : END) ─▶ END

export type GraphFeedback = {
  retryReason?: string;
  customInstruction?: string;
  critiqueNotes?: string;
  priorPattern?: string;
};

interface Winner {
  content: string;
  hookAlternatives: string[];
  score: RubricScore;
  critiqueNotes: string;
}

// Two candidates at different temperatures — a lightweight "debate".
const DEBATE_TEMPS = [0.85, 0.6];

const GenState = Annotation.Root({
  // inputs
  seedText: Annotation<string>(),
  platform: Annotation<PlatformId>(),
  profile: Annotation<PersonaProfile>(),
  userId: Annotation<string>(),
  sourceUrl: Annotation<string | null>(),
  feedback: Annotation<GraphFeedback | undefined>(),
  // working state (checkpointed per node)
  plan: Annotation<Plan | undefined>(),
  research: Annotation<ResearchBrief | undefined>(),
  winner: Annotation<Winner | undefined>(),
  citations: Annotation<Citation[] | undefined>(),
  factNote: Annotation<string | undefined>(),
});

type GenStateType = typeof GenState.State;

// ─── Nodes ───────────────────────────────────────────────────────────────

async function strategistNode(s: GenStateType): Promise<Partial<GenStateType>> {
  return { plan: await planPost(s.seedText, s.platform, s.profile) };
}

async function researcherNode(s: GenStateType): Promise<Partial<GenStateType>> {
  return {
    research: await runResearcher({
      userId: s.userId,
      seedText: s.seedText,
      platform: s.platform,
      profile: s.profile,
      sourceUrl: s.sourceUrl,
    }),
  };
}

async function debateNode(s: GenStateType): Promise<Partial<GenStateType>> {
  const system = buildSystemPrompt(s.platform, s.profile);
  const candidates = await Promise.all(
    DEBATE_TEMPS.map((temperature, i) =>
      completeObject({
        tier: "primary",
        label: `draft:${i}`,
        system,
        prompt: buildGenerationPrompt(s.seedText, s.platform, s.plan!, s.feedback, s.research),
        schema: draftGenSchema,
        temperature,
      }),
    ),
  );
  const reviews = await Promise.all(
    candidates.map((c) => critiqueContent(c.content, s.platform, s.profile)),
  );

  let bestIdx = 0;
  let bestScore = -1;
  reviews.forEach((r, i) => {
    const o = overallScore(r.scores);
    if (o > bestScore) {
      bestScore = o;
      bestIdx = i;
    }
  });
  const draft = candidates[bestIdx];
  const review = reviews[bestIdx];
  const citations = s.research?.citations.length ? s.research.citations : undefined;

  return {
    winner: {
      content: draft.content,
      hookAlternatives: draft.hookAlternatives,
      score: review.scores,
      critiqueNotes: review.notes,
    },
    citations,
  };
}

async function factcheckNode(s: GenStateType): Promise<Partial<GenStateType>> {
  const winner = s.winner!;
  const citations = s.citations ?? [];
  const fc = await completeObject({
    tier: "primary",
    label: "factcheck",
    prompt: buildFactCheckPrompt(winner.content, citations),
    schema: factCheckSchema,
    temperature: 0.1,
  });
  if (!fc.supported && fc.revisedContent) {
    const review = await critiqueContent(fc.revisedContent, s.platform, s.profile);
    return {
      winner: {
        ...winner,
        content: fc.revisedContent,
        score: review.scores,
        critiqueNotes: review.notes,
      },
      factNote: ` Fact-check revised unsupported claims: ${fc.issues.join("; ")}.`,
    };
  }
  if (fc.issues.length) {
    return { factNote: ` Fact-check flags: ${fc.issues.join("; ")}.` };
  }
  return {};
}

function routeAfterDebate(s: GenStateType): "factcheck" | typeof END {
  return s.citations && s.citations.length ? "factcheck" : END;
}

// ─── Graph (built + compiled once, lazily) ───────────────────────────────

function buildWorkflow() {
  return new StateGraph(GenState)
    .addNode("strategist", strategistNode)
    .addNode("researcher", researcherNode)
    .addNode("debate", debateNode)
    .addNode("factcheck", factcheckNode)
    .addEdge(START, "strategist")
    .addEdge(START, "researcher")
    .addEdge(["strategist", "researcher"], "debate") // barrier: waits for both
    .addConditionalEdges("debate", routeAfterDebate, ["factcheck", END])
    .addEdge("factcheck", END);
}

type CompiledGraph = ReturnType<ReturnType<typeof buildWorkflow>["compile"]>;
let compiled: CompiledGraph | null = null;

function getGraph(): CompiledGraph {
  if (!compiled) compiled = buildWorkflow().compile({ checkpointer: getCheckpointer() });
  return compiled;
}

export interface GraphInput {
  seedText: string;
  platform: PlatformId;
  profile: PersonaProfile;
  userId: string;
  sourceUrl?: string | null;
  feedback?: GraphFeedback;
}

function toVariant(platform: PlatformId, final: GenStateType): GeneratedVariant {
  const w = final.winner;
  if (!w) throw new Error("generation graph produced no winner");
  return {
    platform,
    content: w.content,
    hookAlternatives: w.hookAlternatives,
    score: w.score,
    critiqueNotes: w.critiqueNotes + (final.factNote ?? ""),
    autoRewrites: 0,
    citations: final.citations,
  };
}

/** Run the durable generation graph for one platform under a thread id. */
export async function runGenerationGraph(
  input: GraphInput,
  threadId: string,
): Promise<GeneratedVariant> {
  await ensureCheckpointerSetup();
  const graph = getGraph();
  return withSpan(
    { name: `variant:${input.platform}`, kind: "function", input: { platform: input.platform, threadId } },
    async () => {
      const final = (await graph.invoke(
        {
          seedText: input.seedText,
          platform: input.platform,
          profile: input.profile,
          userId: input.userId,
          sourceUrl: input.sourceUrl ?? null,
          feedback: input.feedback,
        },
        { configurable: { thread_id: threadId } },
      )) as GenStateType;
      return toVariant(input.platform, final);
    },
  );
}

/** Resume a crashed/timed-out run from its last checkpoint (same thread id). */
export async function resumeGenerationGraph(
  threadId: string,
  platform: PlatformId,
): Promise<GeneratedVariant> {
  await ensureCheckpointerSetup();
  const graph = getGraph();
  // Passing null resumes pending state without new input.
  const final = (await graph.invoke(null, {
    configurable: { thread_id: threadId },
  })) as GenStateType;
  return toVariant(platform, final);
}
