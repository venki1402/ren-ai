import { randomUUID } from "node:crypto";
import { runGenerationGraph, type GraphFeedback } from "@/lib/ai/agents/graph";
import type { GeneratedVariant } from "@/lib/ai/generate";
import type { PlatformId } from "@/lib/platforms";
import type { PersonaProfile } from "@/lib/persona-shared";

// v2 entry point — now backed by the durable LangGraph pipeline (graph.ts).
// Same signature + return shape as before, so the dispatcher
// (lib/ai/generate-variant.ts) and callers are unchanged. A stable `threadId`
// (idea:platform:version) from the caller makes the run crash-resumable; absent
// one, a unique id is derived (still checkpointed, just not externally resumed).

export async function generatePlatformVariantV2(
  seedText: string,
  platform: PlatformId,
  profile: PersonaProfile,
  ctx: {
    userId: string;
    sourceUrl?: string | null;
    feedback?: GraphFeedback;
    threadId?: string;
  },
): Promise<GeneratedVariant> {
  const threadId = ctx.threadId ?? `${platform}:${randomUUID()}`;
  return runGenerationGraph(
    {
      seedText,
      platform,
      profile,
      userId: ctx.userId,
      sourceUrl: ctx.sourceUrl ?? null,
      feedback: ctx.feedback,
    },
    threadId,
  );
}
