import { z } from "zod";
import type { PlatformId } from "@/lib/platforms";
import { X_MAX_CHARS } from "@/lib/platforms";
import { RUBRIC_AXES } from "@/lib/ai/rubric";
import {
  PERSONA_CONTEXT_FIELDS,
  PERSONA_LABELS,
  isEmptyProfile,
  type PersonaId,
  type PersonaProfile,
} from "@/lib/persona-shared";

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

// ─── Persona conditioning (doc Section 5) ──────────────────────────────────
// The persona is a *voice prior* — it always shapes how the post is written,
// but it is NOT automatically stated in the post. Whether the creator's
// identity surfaces in the text is a per-post decision (identitySalience),
// made by the plan step below.

// Voice guidance per persona — how they sound, not what they say. Generalist
// intentionally carries no strong prior.
const PERSONA_VOICE: Record<PersonaId, string> = {
  student:
    "Writes from a learner's vantage point — candid, curious, specific about what they're figuring out. Comfortable not being the authority; never posturing.",
  developer:
    "Reasons from concrete technical detail — precise, shows the actual work and tradeoffs. Allergic to hand-waving and hype.",
  entrepreneur:
    "Frames around outcomes, decisions, and momentum — opinionated and direct about building and shipping.",
  generalist: "",
};

/**
 * A creator-POV block for the system prompt, or "" when the profile carries no
 * real signal (default generalist, no context) — in which case we don't invent
 * one. Describes who the creator is so the model writes from their vantage
 * point; the plan step decides how much of it shows.
 */
export function buildPersonaBlock(profile: PersonaProfile): string {
  if (isEmptyProfile(profile)) return "";

  const lines: string[] = [];
  const voice = PERSONA_VOICE[profile.persona];
  lines.push(`- Persona: ${PERSONA_LABELS[profile.persona]}.${voice ? ` ${voice}` : ""}`);

  if (profile.context) {
    for (const { key, label } of PERSONA_CONTEXT_FIELDS) {
      const v = profile.context[key];
      if (v) lines.push(`- ${label}: ${v}`);
    }
  }

  return `You are writing as one specific creator. Their point of view:
${lines.join("\n")}

Write from this point of view and voice. Do NOT invent facts about them beyond what's stated above. Whether to name their role/situation in the post itself is decided per-post (see the plan) — carrying their POV does not require announcing who they are.`;
}

/** Platform system prompt with the creator's persona conditioning layered in. */
export function buildSystemPrompt(
  platform: PlatformId,
  profile: PersonaProfile,
): string {
  const base = PLATFORM_SYSTEM_PROMPTS[platform];
  const persona = buildPersonaBlock(profile);
  return persona ? `${base}\n\n${persona}` : base;
}

// ─── Plan step (the "reason" before drafting) ──────────────────────────────
// A cheap structured pass that picks the angle + hook strategy and, crucially,
// decides how loud the creator's identity should be in this specific post.
// This is what stops every post from announcing the persona.

export const IDENTITY_SALIENCE = ["foreground", "background", "none"] as const;
export type IdentitySalience = (typeof IDENTITY_SALIENCE)[number];

const SALIENCE_INSTRUCTION: Record<IdentitySalience, string> = {
  foreground:
    "State the creator's role/situation in the post — their identity is what gives this take credibility or relatability.",
  background:
    "Write from the creator's POV and voice, but do NOT state their role or persona outright. The vantage point shows through the take, not a self-introduction.",
  none: "A pure value/idea post — the creator's identity is irrelevant here; don't reference it at all.",
};

export const planSchema = z.object({
  angle: z.string().describe("The single sharpest angle to take, in one sentence."),
  hookStrategy: z
    .string()
    .describe(
      "The kind of hook that fits (e.g. contrarian take, personal story, surprising stat, pointed question).",
    ),
  identitySalience: z
    .enum(IDENTITY_SALIENCE)
    .describe(
      "How much the creator's identity should show in the post itself. Default to 'background'; 'foreground' only when their identity genuinely adds credibility/relatability; 'none' for purely informational takes.",
    ),
});

export type Plan = z.infer<typeof planSchema>;

/** Build the plan prompt for a platform + creator profile. */
export function buildPlanPrompt(
  seedText: string,
  platform: PlatformId,
  profile: PersonaProfile,
): string {
  const persona = buildPersonaBlock(profile);
  const parts = [
    `Plan a ${platform === "x" ? "X" : "LinkedIn"} post from this creator's seed idea.`,
  ];
  if (persona) parts.push(persona);
  parts.push(`Seed idea:\n"""\n${seedText}\n"""`);
  parts.push(
    `Decide the angle, the hook strategy, and how much the creator's identity should surface in the post (identitySalience). Most posts should be "background" — carry the creator's POV without announcing who they are. Use "foreground" only when stating their identity genuinely strengthens the post, and "none" for purely informational takes.`,
  );
  return parts.join("\n\n");
}

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
  customInstruction?: string; // freeform "change exactly this" from the creator
  critiqueNotes?: string; // notes from the critique loop
};

/** Build the generation user-prompt for a platform from a seed idea + plan. */
export function buildGenerationPrompt(
  seedText: string,
  platform: PlatformId,
  plan: Plan,
  feedback?: GenerationFeedback,
): string {
  const parts = [
    `Seed idea from the creator:\n"""\n${seedText}\n"""`,
    `Plan for this post:
- Angle: ${plan.angle}
- Hook strategy: ${plan.hookStrategy}
- Identity salience: ${SALIENCE_INSTRUCTION[plan.identitySalience]}`,
    `Produce 2-3 candidate hooks and one full ${platform === "x" ? "X" : "LinkedIn"} post that leads with the strongest hook.`,
  ];
  // A creator's explicit instruction is the strongest signal — it outranks the
  // canned retry reason.
  if (feedback?.customInstruction) {
    parts.push(
      `The creator gave an explicit instruction for this rewrite — follow it directly, above all else:\n"""\n${feedback.customInstruction}\n"""`,
    );
  } else if (feedback?.retryReason) {
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
export function buildCritiquePrompt(
  content: string,
  platform: PlatformId,
  profile: PersonaProfile,
): string {
  const persona = buildPersonaBlock(profile);
  const voiceGuidance = persona
    ? `Under "voice_fit", judge whether this reads like it was written by that specific creator, from their POV and voice — not a generic post. Do NOT require them to state their identity; a post can fit their voice without naming their role.`
    : `Under "voice_fit", judge whether the post has a consistent, genuine point of view rather than a generic, voice-less tone.`;

  return `Critique this ${platform === "x" ? "X" : "LinkedIn"} post against the rubric.
${persona ? `\nThe creator's point of view:\n${persona}\n` : ""}
Score each axis 0-10: ${RUBRIC_AXES.join(", ")}.
Be a demanding editor. Penalize AI-tells hard under "authenticity".
${voiceGuidance}
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
