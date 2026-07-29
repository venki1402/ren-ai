import { defineConfig } from "vitest/config";
import path from "node:path";

// Two suites:
//   - unit tests (lib/**/*.test.ts): pure, fast, offline, no keys.
//   - evals (evals/**/*.eval.test.ts): hit the real LLM+DB pipeline, so they
//     only run when RUN_EVALS=1 (see evals/*, guarded with describe.skipIf).
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "evals/**/*.eval.test.ts"],
    testTimeout: 300_000, // evals make several LLM calls per case; web-grounded
    // cases add a Tavily search + fact-check + revise pass, and Groq's free-tier
    // TPM limit inserts backoff waits — so a single case can run for minutes.
    setupFiles: ["dotenv/config"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
