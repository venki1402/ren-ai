import { completeObject } from "@/lib/ai/groq";
import {
  buildCritiquePrompt,
  buildGenerationPrompt,
  buildPlanPrompt,
  buildRewritePrompt,
  buildSystemPrompt,
  draftGenSchema,
  planSchema,
  type Plan,
} from "@/lib/ai/prompts";
import {
  MAX_AUTO_REWRITES,
  critiqueSchema,
  isBelowThreshold,
  type Critique,
  type RubricScore,
} from "@/lib/ai/rubric";
import type { PlatformId } from "@/lib/platforms";
import type { PersonaProfile } from "@/lib/persona-shared";
import { withSpan } from "@/lib/ai/observability/trace";
import type { Citation } from "@/lib/ai/agents/types";

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
  citations?: Citation[]; // grounding sources (v2 pipeline only)
}

type Feedback = {
  retryReason?: string;
  customInstruction?: string;
  critiqueNotes?: string;
  priorPattern?: string;
};

/** Score existing content against the rubric (also used after manual edits). */
export async function critiqueContent(
  content: string,
  platform: PlatformId,
  profile: PersonaProfile,
): Promise<Critique> {
  return completeObject({
    tier: "primary",
    label: "critique",
    prompt: buildCritiquePrompt(content, platform, profile),
    schema: critiqueSchema,
    temperature: 0.2,
  });
}

/** Plan step (doc Section 5): pick the angle, hook strategy, and how loud the
 * creator's identity should be — before any drafting happens. */
export async function planPost(
  seedText: string,
  platform: PlatformId,
  profile: PersonaProfile,
): Promise<Plan> {
  return completeObject({
    tier: "light",
    label: "plan",
    prompt: buildPlanPrompt(seedText, platform, profile),
    schema: planSchema,
    temperature: 0.4,
  });
}

/**
 * Generate one platform variant: plan → draft → critique → (auto-rewrite ×N if
 * below threshold) → critique again. The plan decides the angle and how much
 * the creator's persona surfaces; drafting/critique are persona-conditioned.
 * Caps rewrites so it never loops silently.
 */
export async function generatePlatformVariant(
  seedText: string,
  platform: PlatformId,
  profile: PersonaProfile,
  feedback?: Feedback,
): Promise<GeneratedVariant> {
  // Group this platform's steps (plan/draft/critique/rewrite) under one span so
  // the trace reads as a tree per platform.
  return withSpan(
    { name: `variant:${platform}`, kind: "function", input: { platform } },
    () => runPlatformVariant(seedText, platform, profile, feedback),
  );
}

async function runPlatformVariant(
  seedText: string,
  platform: PlatformId,
  profile: PersonaProfile,
  feedback?: Feedback,
): Promise<GeneratedVariant> {
  const system = buildSystemPrompt(platform, profile);
  const plan = await planPost(seedText, platform, profile);

  let draft = await completeObject({
    tier: "primary",
    label: "draft",
    system,
    prompt: buildGenerationPrompt(seedText, platform, plan, feedback),
    schema: draftGenSchema,
    temperature: 0.8,
  });

  let review = await critiqueContent(draft.content, platform, profile);
  let autoRewrites = 0;

  while (
    (review.needsRewrite || isBelowThreshold(review.scores)) &&
    autoRewrites < MAX_AUTO_REWRITES
  ) {
    autoRewrites += 1;
    // Lighter, cheaper model for the rewrite pass.
    draft = await completeObject({
      tier: "light",
      label: `rewrite:${autoRewrites}`,
      system,
      prompt: buildRewritePrompt(draft.content, platform, review.notes),
      schema: draftGenSchema,
      temperature: 0.7,
    });
    review = await critiqueContent(draft.content, platform, profile);
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
