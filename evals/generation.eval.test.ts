import { describe, it, expect, afterAll } from "vitest";
import { generateVariant, isV2Pipeline } from "@/lib/ai/generate-variant";
import {
  loadDataset,
  profileOf,
  judge,
  behavioralChecks,
  formatReport,
  type CaseResult,
} from "./harness";

// End-to-end generation evals: run each golden case through the REAL pipeline
// (whichever REN_PIPELINE_V2 selects — so this doubles as a v1-vs-v2 regression
// harness), then score with the self-consistency LLM judge + deterministic
// behavioral checks. Skipped unless RUN_EVALS=1 since it calls the live API.

const RUN = process.env.RUN_EVALS === "1";
const cases = RUN ? loadDataset() : [];
const results: CaseResult[] = [];

describe.skipIf(!RUN)(`generation evals (pipeline=${isV2Pipeline() ? "v2" : "v1"})`, () => {
  it.each(cases)("$id", async (c) => {
    const profile = profileOf(c);
    const variant = await generateVariant(c.seedText, c.platform, profile, {
      userId: `eval:${c.id}`, // no stored posts → voice retrieval is empty, fine
      sourceUrl: c.sourceUrl ?? null,
    });

    const { overall } = await judge(variant.content, c.platform, profile);
    const behavioral = behavioralChecks(variant.content, c.platform, variant.citations ?? []);

    results.push({
      id: c.id,
      platform: c.platform,
      overall,
      minOverall: c.minOverall,
      passed: overall >= c.minOverall && behavioral.aiTells.length === 0 && behavioral.format.ok,
      aiTells: behavioral.aiTells,
      formatOk: behavioral.format.ok,
    });

    // Hard assertions: quality bar + no AI-tells + platform format.
    expect(overall).toBeGreaterThanOrEqual(c.minOverall);
    expect(behavioral.aiTells, `AI-tells: ${behavioral.aiTells.join(", ")}`).toEqual([]);
    expect(behavioral.format.ok, behavioral.format.issues.join("; ")).toBe(true);
  });

  afterAll(() => {
    if (results.length) console.log("\n" + formatReport(results) + "\n");
  });
});
