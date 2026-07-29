import { completeObject } from "@/lib/ai/groq";
import {
  buildFactCheckPrompt,
  buildGenerationPrompt,
  buildSystemPrompt,
  draftGenSchema,
  factCheckSchema,
} from "@/lib/ai/prompts";
import { critiqueContent, planPost, type GeneratedVariant } from "@/lib/ai/generate";
import { runResearcher } from "@/lib/ai/agents/researcher";
import { overallScore } from "@/lib/score";
import { withSpan } from "@/lib/ai/observability/trace";
import type { PlatformId } from "@/lib/platforms";
import type { PersonaProfile } from "@/lib/persona-shared";

// LEGACY: the original imperative v2 orchestrator, superseded by the durable
// LangGraph version in graph.ts. Kept (unwired) for A/B comparison in evals and
// as provenance for the pre-LangGraph implementation. Not imported by the app.

type Feedback = {
  retryReason?: string;
  customInstruction?: string;
  critiqueNotes?: string;
  priorPattern?: string;
};

const DEBATE_TEMPS = [0.85, 0.6];

export async function generatePlatformVariantV2Legacy(
  seedText: string,
  platform: PlatformId,
  profile: PersonaProfile,
  ctx: { userId: string; sourceUrl?: string | null; feedback?: Feedback },
): Promise<GeneratedVariant> {
  return withSpan(
    { name: `variant:${platform}`, kind: "function", input: { platform } },
    async () => {
      const system = buildSystemPrompt(platform, profile);

      const [plan, research] = await Promise.all([
        planPost(seedText, platform, profile),
        runResearcher({ userId: ctx.userId, seedText, platform, profile, sourceUrl: ctx.sourceUrl }),
      ]);

      const candidates = await Promise.all(
        DEBATE_TEMPS.map((temperature, i) =>
          completeObject({
            tier: "primary",
            label: `draft:${i}`,
            system,
            prompt: buildGenerationPrompt(seedText, platform, plan, ctx.feedback, research),
            schema: draftGenSchema,
            temperature,
          }),
        ),
      );
      const reviews = await Promise.all(
        candidates.map((c) => critiqueContent(c.content, platform, profile)),
      );

      let bestIdx = 0;
      let bestScore = -1;
      reviews.forEach((r, i) => {
        const s = overallScore(r.scores);
        if (s > bestScore) {
          bestScore = s;
          bestIdx = i;
        }
      });

      let draft = candidates[bestIdx];
      let review = reviews[bestIdx];

      let factNote = "";
      if (research.citations.length) {
        const fc = await completeObject({
          tier: "primary",
          label: "factcheck",
          prompt: buildFactCheckPrompt(draft.content, research.citations),
          schema: factCheckSchema,
          temperature: 0.1,
        });
        if (!fc.supported && fc.revisedContent) {
          draft = { ...draft, content: fc.revisedContent };
          review = await critiqueContent(draft.content, platform, profile);
          factNote = ` Fact-check revised unsupported claims: ${fc.issues.join("; ")}.`;
        } else if (fc.issues.length) {
          factNote = ` Fact-check flags: ${fc.issues.join("; ")}.`;
        }
      }

      return {
        platform,
        content: draft.content,
        hookAlternatives: draft.hookAlternatives,
        score: review.scores,
        critiqueNotes: review.notes + factNote,
        autoRewrites: 0,
        citations: research.citations.length ? research.citations : undefined,
      };
    },
  );
}
