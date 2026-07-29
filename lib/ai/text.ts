// Pure, dependency-free text utilities (no db, no model, no network) so they're
// trivially unit-testable and reusable across ingestion and the eval harness.

import { X_MAX_CHARS, type PlatformId } from "@/lib/platforms";

const DEFAULT_CHUNK_SIZE = 1000; // chars
const DEFAULT_CHUNK_OVERLAP = 150;

/** Split text into overlapping character windows for embedding. */
export function chunkText(
  text: string,
  size = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP,
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const step = Math.max(1, size - overlap);
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += step) {
    chunks.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return chunks;
}

// ─── AI-tell detection ───────────────────────────────────────────────────────
// The rubric's "authenticity" axis is an LLM judgment; this is a cheap,
// deterministic complement used as a behavioral eval check and a unit-test
// anchor. Each pattern is a well-known LLM tell called out in the prompts.

export interface AiTell {
  label: string;
  pattern: RegExp;
}

export const AI_TELLS: AiTell[] = [
  { label: "generic-opener", pattern: /\b(in today's (fast-paced|digital) world|let's dive in|imagine a world|in the world of)\b/i },
  { label: "not-just-but", pattern: /\bnot just\b[^.?!]{0,60}\bbut\b/i },
  { label: "hype-adjective", pattern: /\b(game-?changer|revolutionary|cutting-edge|unlock(ing)? the power|supercharge)\b/i },
  { label: "hedging", pattern: /\b(arguably|it's worth noting|needless to say|it goes without saying)\b/i },
  { label: "listicle-filler", pattern: /\b(here are \d+ (ways|tips|reasons|things)|top \d+)\b/i },
  { label: "em-dash-overuse", pattern: /(—[^—]{1,80}){3,}/ },
];

/** All AI-tell labels present in the text (empty = clean). */
export function detectAiTells(text: string): string[] {
  return AI_TELLS.filter((t) => t.pattern.test(text)).map((t) => t.label);
}

// ─── Platform format checks ──────────────────────────────────────────────────

export interface FormatCheck {
  ok: boolean;
  issues: string[];
}

/** Deterministic platform-fit checks (length, structure) used in evals. */
export function checkPlatformFormat(content: string, platform: PlatformId): FormatCheck {
  const issues: string[] = [];
  if (platform === "x") {
    if (content.length > X_MAX_CHARS)
      issues.push(`over ${X_MAX_CHARS} chars (${content.length})`);
  } else {
    const firstLines = content.split("\n").slice(0, 3).join(" ").trim();
    if (firstLines.length < 20) issues.push("weak pre-fold hook (first lines too short)");
    if (!content.includes("\n")) issues.push("no line breaks (wall of text)");
  }
  return { ok: issues.length === 0, issues };
}
