import { z } from "zod";
import type { PlatformId } from "@/lib/platforms";
import { X_MAX_CHARS } from "@/lib/platforms";
import { RUBRIC_AXES } from "@/lib/ai/rubric";

// Platform-specific prompting (doc Section 6). Each platform gets its OWN
// system prompt — never one prompt reformatted per platform.

// Shared authenticity pass — applied to every platform (Section 6, last para).
const AUTHENTICITY = `Write like a real person, not an AI. Explicitly avoid:
- Em-dash overuse and "not just X, but Y" constructions
- Generic openers ("In today's fast-paced world", "Let's dive in", "Imagine a world")
- Listicle filler and hedging language ("arguably", "it's worth noting")
- Corporate buzzwords and hype adjectives ("game-changer", "revolutionary")
Prefer concrete specifics, plain verbs, and a genuine point of view.`;

const X_SYSTEM = `You write posts for X (formerly Twitter) for a single creator's personal account.

Rules:
- SINGLE POST ONLY. Do not write threads. The whole idea must fit in one post of at most ${X_MAX_CHARS} characters.
- Punchy, front-loaded hook in the very first line. No preamble, no throat-clearing.
- Opinion-forward / reply-bait framing works better here than narrative.
- Cut every non-essential word. Every line must justify its existence.

${AUTHENTICITY}`;

const LINKEDIN_SYSTEM = `You write posts for LinkedIn for a single creator's personal profile.

Rules:
- The first 2-3 lines are all that's visible before the "see more" fold — that IS the hook. Optimize those lines hardest.
- Use a narrative / story-arc structure; it rewards dwell time and comments more than dense information.
- Short paragraphs and line breaks for scannability — never dense walls of text.
- Comments are weighted more heavily than likes, so end with a genuine, specific discussion prompt — not a generic "thoughts?".

${AUTHENTICITY}`;

export const PLATFORM_SYSTEM_PROMPTS: Record<PlatformId, string> = {
  x: X_SYSTEM,
  linkedin: LINKEDIN_SYSTEM,
};

// Structured generation output: candidate hooks + the chosen full draft.
export const draftGenSchema = z.object({
  hookAlternatives: z
    .array(z.string())
    .min(2)
    .max(3)
    .describe("2-3 distinct candidate opening hooks for this platform."),
  content: z
    .string()
    .describe(
      "The full post, leading with the single strongest hook from hookAlternatives.",
    ),
});

export type DraftGen = z.infer<typeof draftGenSchema>;

type GenerationFeedback = {
  retryReason?: string; // human-readable retry chip reason
  critiqueNotes?: string; // notes from the critique loop
};

/** Build the generation user-prompt for a platform from a seed idea. */
export function buildGenerationPrompt(
  seedText: string,
  platform: PlatformId,
  feedback?: GenerationFeedback,
): string {
  const parts = [
    `Seed idea from the creator:\n"""\n${seedText}\n"""`,
    `Produce 2-3 candidate hooks and one full ${platform === "x" ? "X" : "LinkedIn"} post that leads with the strongest hook.`,
  ];
  if (feedback?.retryReason) {
    parts.push(
      `The creator rejected the previous attempt for this reason: "${feedback.retryReason}". Directly address that in this rewrite.`,
    );
  }
  if (feedback?.critiqueNotes) {
    parts.push(`Critique of the previous attempt to fix:\n${feedback.critiqueNotes}`);
  }
  return parts.join("\n\n");
}

// Critique prompt (Section 5.4). Structured output validated by critiqueSchema.
export function buildCritiquePrompt(content: string, platform: PlatformId): string {
  return `Critique this ${platform === "x" ? "X" : "LinkedIn"} post against the rubric.

Score each axis 0-10: ${RUBRIC_AXES.join(", ")}.
Be a demanding editor. Penalize AI-tells hard under "authenticity".
${platform === "x" ? `Under "formatting_fit", check it reads as a complete single post within ${X_MAX_CHARS} characters.` : `Under "formatting_fit", check the first 2-3 lines work as a pre-fold hook and paragraphs are scannable.`}

Post to critique:
"""
${content}
"""`;
}

/** Build a rewrite prompt that feeds critique notes back in (Section 5.4). */
export function buildRewritePrompt(
  content: string,
  platform: PlatformId,
  critiqueNotes: string,
): string {
  return `Rewrite this ${platform === "x" ? "X" : "LinkedIn"} post to fix the critique below. Keep what works; fix what doesn't. Return 2-3 fresh hook options and the improved full post.

Critique to address:
${critiqueNotes}

Current post:
"""
${content}
"""`;
}
