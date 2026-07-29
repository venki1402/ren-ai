import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { modelFor, modelIdFor } from "@/lib/ai/groq";
import { retrieveVoiceExemplars, retrieveGrounding } from "@/lib/ai/retrieval";
import { buildResearchSystemPrompt, buildResearchPrompt } from "@/lib/ai/prompts";
import { withSpan } from "@/lib/ai/observability/trace";
import type { PlatformId } from "@/lib/platforms";
import type { PersonaProfile } from "@/lib/persona-shared";
import type { Citation, ResearchBrief, VoiceExemplar } from "@/lib/ai/agents/types";

// The Researcher: a genuine tool-using agent. It's given two retrieval tools
// and decides for itself what to query, then synthesizes a brief. We capture
// the actual retrieved items deterministically (as the tools execute) so the
// downstream Drafters get concrete voice exemplars + citations regardless of
// what the model writes in its prose brief.

export async function runResearcher(opts: {
  userId: string;
  seedText: string;
  platform: PlatformId;
  profile: PersonaProfile;
  sourceUrl?: string | null;
}): Promise<ResearchBrief> {
  const { userId, seedText, platform, profile, sourceUrl } = opts;

  return withSpan(
    { name: "agent:researcher", kind: "agent", input: { seedText, sourceUrl } },
    async () => {
      const voiceHits: VoiceExemplar[] = [];
      const citationHits: Citation[] = [];

      const tools = {
        findVoiceExemplars: tool({
          description:
            "Retrieve the creator's OWN past posts most similar to a query, for voice reference.",
          inputSchema: z.object({
            query: z.string().describe("topic to search the creator's past posts for"),
          }),
          execute: async ({ query }) => {
            const hits = await retrieveVoiceExemplars(userId, query, 3);
            for (const h of hits)
              voiceHits.push({
                platform: h.platform,
                content: h.content,
                similarity: h.similarity,
              });
            return hits.map((h) => ({
              platform: h.platform,
              similarity: Number(h.similarity.toFixed(3)),
              preview: h.content.slice(0, 200),
            }));
          },
        }),
        findGrounding: tool({
          description:
            "Retrieve real source facts relevant to a query, to ground and cite claims.",
          inputSchema: z.object({
            query: z.string().describe("claim or topic to find supporting facts for"),
          }),
          execute: async ({ query }) => {
            const hits = await retrieveGrounding(query, {
              k: 5,
              sourceUrl: sourceUrl ?? undefined,
            });
            for (const h of hits)
              citationHits.push({
                sourceUrl: h.sourceUrl,
                title: h.title,
                snippet: h.content.slice(0, 400),
              });
            return hits.map((h) => ({
              source: h.sourceUrl,
              similarity: Number(h.similarity.toFixed(3)),
              text: h.content.slice(0, 300),
            }));
          },
        }),
      };

      try {
        const result = await withSpan(
          {
            name: "llm:research",
            kind: "llm",
            tier: "primary",
            model: modelIdFor("primary"),
            input: { seedText },
          },
          () =>
            generateText({
              model: modelFor("primary"),
              system: buildResearchSystemPrompt(profile),
              prompt: buildResearchPrompt(seedText, platform, !!sourceUrl),
              tools,
              stopWhen: stepCountIs(5),
              maxRetries: 0,
            }),
          (r) => ({
            model: modelIdFor("primary"),
            tier: "primary",
            usage: r.totalUsage as {
              inputTokens?: number;
              outputTokens?: number;
              totalTokens?: number;
            },
            output: r.text,
          }),
        );

        return {
          brief: result.text ?? "",
          voiceExemplars: dedupeVoice(voiceHits),
          citations: dedupeCitations(citationHits),
        };
      } catch (err) {
        // Tool-calling unsupported or the agent failed — degrade gracefully by
        // fetching voice exemplars directly so drafting still benefits.
        console.warn("[researcher] falling back to direct retrieval:", (err as Error).message);
        const hits = await retrieveVoiceExemplars(userId, seedText, 3).catch(() => []);
        for (const h of hits)
          voiceHits.push({
            platform: h.platform,
            content: h.content,
            similarity: h.similarity,
          });
        return { brief: "", voiceExemplars: dedupeVoice(voiceHits), citations: [] };
      }
    },
  );
}

function dedupeVoice(items: VoiceExemplar[]): VoiceExemplar[] {
  const seen = new Set<string>();
  const out: VoiceExemplar[] = [];
  for (const i of items) {
    if (seen.has(i.content)) continue;
    seen.add(i.content);
    out.push(i);
  }
  return out.slice(0, 3);
}

function dedupeCitations(items: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const i of items) {
    const key = `${i.sourceUrl}::${i.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out.slice(0, 6);
}
