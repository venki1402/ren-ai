import { completeObject } from "@/lib/ai/groq";
import {
  PLATFORM_SYSTEM_PROMPTS,
  buildCritiquePrompt,
  buildGenerationPrompt,
  buildRewritePrompt,
  draftGenSchema,
} from "@/lib/ai/prompts";
import {
  MAX_AUTO_REWRITES,
  critiqueSchema,
  isBelowThreshold,
  type Critique,
  type RubricScore,
} from "@/lib/ai/rubric";
import type { PlatformId } from "@/lib/platforms";

// Draft generation + critique/rewrite loop for a single platform (Sections
// 5.3-5.4). Drafting + critique run on the primary model; the lighter rewrite
// pass runs on the secondary model (separate rate-limit pools, Note 10).

export interface GeneratedVariant {
  platform: PlatformId;
  content: string;
  hookAlternatives: string[];
  score: RubricScore;
  critiqueNotes: string;
  autoRewrites: number;
}

type Feedback = {
  retryReason?: string;
  critiqueNotes?: string;
};

/** Score existing content against the rubric (also used after manual edits). */
export async function critiqueContent(
  content: string,
  platform: PlatformId,
): Promise<Critique> {
  return completeObject({
    tier: "primary",
    prompt: buildCritiquePrompt(content, platform),
    schema: critiqueSchema,
    temperature: 0.2,
  });
}

/**
 * Generate one platform variant: draft → critique → (auto-rewrite ×N if below
 * threshold) → critique again. Caps rewrites so it never loops silently.
 */
export async function generatePlatformVariant(
  seedText: string,
  platform: PlatformId,
  feedback?: Feedback,
): Promise<GeneratedVariant> {
  const system = PLATFORM_SYSTEM_PROMPTS[platform];

  let draft = await completeObject({
    tier: "primary",
    system,
    prompt: buildGenerationPrompt(seedText, platform, feedback),
    schema: draftGenSchema,
    temperature: 0.8,
  });

  let review = await critiqueContent(draft.content, platform);
  let autoRewrites = 0;

  while (
    (review.needsRewrite || isBelowThreshold(review.scores)) &&
    autoRewrites < MAX_AUTO_REWRITES
  ) {
    autoRewrites += 1;
    // Lighter, cheaper model for the rewrite pass.
    draft = await completeObject({
      tier: "light",
      system,
      prompt: buildRewritePrompt(draft.content, platform, review.notes),
      schema: draftGenSchema,
      temperature: 0.7,
    });
    review = await critiqueContent(draft.content, platform);
  }

  return {
    platform,
    content: draft.content,
    hookAlternatives: draft.hookAlternatives,
    score: review.scores,
    critiqueNotes: review.notes,
    autoRewrites,
  };
}
