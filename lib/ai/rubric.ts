import { z } from "zod";

// Explicit, transparent rubric (doc Section 5.4 / Note 10) — NOT a black-box
// "virality score". Each axis is 0-10. The UI shows exactly these.

export const rubricSchema = z.object({
  hook_strength: z
    .number()
    .min(0)
    .max(10)
    .describe("Does the opening grab attention for this platform?"),
  clarity: z.number().min(0).max(10).describe("Is the point clear and easy to follow?"),
  authenticity: z
    .number()
    .min(0)
    .max(10)
    .describe("Free of AI-tells (em-dash overuse, generic openers, hedging)?"),
  cta_presence: z
    .number()
    .min(0)
    .max(10)
    .describe("Effective call-to-action, or intentional/appropriate absence?"),
  formatting_fit: z
    .number()
    .min(0)
    .max(10)
    .describe("Fits the platform's formatting norms (length, breaks, structure)?"),
  voice_fit: z
    .number()
    .min(0)
    .max(10)
    .describe("Reads like this specific creator's POV/voice, not a generic post?"),
});

export type RubricScore = z.infer<typeof rubricSchema>;

export const RUBRIC_AXES = [
  "hook_strength",
  "clarity",
  "authenticity",
  "cta_presence",
  "formatting_fit",
  "voice_fit",
] as const;

export type RubricAxis = (typeof RUBRIC_AXES)[number];

export const RUBRIC_AXIS_LABELS: Record<RubricAxis, string> = {
  hook_strength: "Hook strength",
  clarity: "Clarity",
  authenticity: "Authenticity",
  cta_presence: "CTA",
  formatting_fit: "Formatting fit",
  voice_fit: "Voice fit",
};

// Below this on any axis triggers an auto-rewrite pass (capped, Section 5.4).
export const SCORE_THRESHOLD = 7;

export const MAX_AUTO_REWRITES = 2;

export const critiqueSchema = z.object({
  scores: rubricSchema,
  notes: z
    .string()
    .describe("Concise, specific critique explaining the scores and what to fix."),
  needsRewrite: z
    .boolean()
    .describe("True if any axis is below threshold and a rewrite would help."),
});

export type Critique = z.infer<typeof critiqueSchema>;

/** True if any rubric axis falls below the rewrite threshold. */
export function isBelowThreshold(scores: RubricScore): boolean {
  return RUBRIC_AXES.some((axis) => scores[axis] < SCORE_THRESHOLD);
}
