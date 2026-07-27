import {
  RUBRIC_AXES,
  SCORE_THRESHOLD,
  type RubricAxis,
  type RubricScore,
} from "@/lib/ai/rubric";

// Client-safe score helpers (no server deps) for rendering the rubric in the UI.
// The rubric is explicit and transparent by design — NOT a black-box "virality
// score" (doc Note 10).

/**
 * Coerce a stored `Json` score into a typed RubricScore, or null if malformed.
 * Tolerant of axis drift: a score persisted before an axis existed (e.g. older
 * variants without `voice_fit`) is still valid — the missing axis is simply
 * absent, and the display/mean helpers below skip non-numeric axes.
 */
export function parseScore(raw: unknown): RubricScore | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const hasAny = RUBRIC_AXES.some((axis) => typeof obj[axis] === "number");
  return hasAny ? (obj as RubricScore) : null;
}

/** Mean of the present numeric axes, 0-10, rounded to one decimal. */
export function overallScore(score: RubricScore): number {
  const present = RUBRIC_AXES.filter((axis) => typeof score[axis] === "number");
  if (present.length === 0) return 0;
  const sum = present.reduce((acc, axis) => acc + score[axis], 0);
  return Math.round((sum / present.length) * 10) / 10;
}

export type ScoreTone = "good" | "warn" | "bad";

/** Map a 0-10 axis value to a semantic tone (matches the --good/warn/bad tokens). */
export function toneFor(value: number): ScoreTone {
  if (value >= SCORE_THRESHOLD) return "good";
  if (value >= 4) return "warn";
  return "bad";
}

export const TONE_VAR: Record<ScoreTone, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

export type { RubricAxis, RubricScore };
