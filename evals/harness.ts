import { readFileSync } from "node:fs";
import path from "node:path";
import { critiqueContent } from "@/lib/ai/generate";
import { overallScore } from "@/lib/score";
import { detectAiTells, checkPlatformFormat } from "@/lib/ai/text";
import { RUBRIC_AXES, type RubricScore } from "@/lib/ai/rubric";
import type { PlatformId } from "@/lib/platforms";
import type { PersonaId, PersonaContext, PersonaProfile } from "@/lib/persona-shared";
import type { Citation } from "@/lib/ai/agents/types";

// Eval harness helpers, kept out of the test file so they can be reused by a CLI
// reporter and the CI job.

export interface EvalCase {
  id: string;
  seedText: string;
  persona: PersonaId;
  context?: PersonaContext;
  platform: PlatformId;
  sourceUrl?: string;
  minOverall: number;
}

export function loadDataset(): EvalCase[] {
  const file = path.resolve(process.cwd(), "evals/dataset.jsonl");
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EvalCase);
}

export function profileOf(c: EvalCase): PersonaProfile {
  return { persona: c.persona, context: c.context ?? null };
}

/**
 * LLM-as-judge with self-consistency: score `samples` times and average each
 * axis. Averaging dampens the single-sample variance that makes a lone judge
 * call an unreliable metric.
 */
export async function judge(
  content: string,
  platform: PlatformId,
  profile: PersonaProfile,
  samples = 2,
): Promise<{ scores: RubricScore; overall: number }> {
  const runs = await Promise.all(
    Array.from({ length: samples }, () => critiqueContent(content, platform, profile)),
  );
  const scores = Object.fromEntries(
    RUBRIC_AXES.map((axis) => [
      axis,
      runs.reduce((s, r) => s + r.scores[axis], 0) / runs.length,
    ]),
  ) as unknown as RubricScore;
  return { scores, overall: overallScore(scores) };
}

export interface BehavioralResult {
  aiTells: string[];
  format: { ok: boolean; issues: string[] };
  groundedCitations: number;
}

/** Deterministic, model-free checks that complement the LLM judge. */
export function behavioralChecks(
  content: string,
  platform: PlatformId,
  citations: Citation[] = [],
): BehavioralResult {
  return {
    aiTells: detectAiTells(content),
    format: checkPlatformFormat(content, platform),
    groundedCitations: citations.length,
  };
}

export interface CaseResult {
  id: string;
  platform: PlatformId;
  overall: number;
  minOverall: number;
  passed: boolean;
  aiTells: string[];
  formatOk: boolean;
}

/** Render a compact score report (used by the eval test and CI). */
export function formatReport(results: CaseResult[]): string {
  const lines = results.map(
    (r) =>
      `${r.passed ? "✓" : "✗"} ${r.id.padEnd(22)} ${r.platform.padEnd(9)} ` +
      `overall=${r.overall.toFixed(2)} (min ${r.minOverall}) ` +
      `${r.aiTells.length ? `ai-tells=[${r.aiTells.join(",")}] ` : ""}` +
      `${r.formatOk ? "" : "format!"}`,
  );
  const passed = results.filter((r) => r.passed).length;
  const avg = results.reduce((s, r) => s + r.overall, 0) / (results.length || 1);
  lines.push(`\n${passed}/${results.length} passed · mean overall ${avg.toFixed(2)}`);
  return lines.join("\n");
}
