import { describe, it, expect } from "vitest";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import { ensureCheckpointerSetup, getCheckpointer } from "@/lib/ai/agents/checkpointer";

// Proves the durability guarantee the real pipeline relies on: with the Postgres
// checkpointer, a run that crashes mid-way RESUMES from its last checkpoint —
// already-completed nodes are NOT re-executed. Uses a minimal graph with the
// same primitives (StateGraph + PostgresSaver + edges) and counting/failing
// nodes, so it's deterministic and needs no LLM. Skipped in CI's offline job
// (no DATABASE_URL); runs locally where dotenv provides it.

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("LangGraph durability — resume from checkpoint", () => {
  it("does not re-run completed nodes after a mid-run crash", async () => {
    await ensureCheckpointerSetup();

    const calls = { a: 0, b: 0, c: 0 };
    let failCOnce = true;

    const S = Annotation.Root({
      value: Annotation<string>(),
      steps: Annotation<string[]>({
        reducer: (l, r) => [...(l ?? []), ...r],
        default: () => [],
      }),
    });

    const graph = new StateGraph(S)
      .addNode("a", async () => {
        calls.a += 1;
        return { steps: ["a"] };
      })
      .addNode("b", async () => {
        calls.b += 1;
        return { steps: ["b"] };
      })
      .addNode("c", async () => {
        calls.c += 1;
        if (failCOnce) {
          failCOnce = false; // crash the first time only
          throw new Error("boom in c");
        }
        return { steps: ["c"], value: "done" };
      })
      .addEdge(START, "a")
      .addEdge("a", "b")
      .addEdge("b", "c")
      .addEdge("c", END)
      .compile({ checkpointer: getCheckpointer() });

    const cfg = { configurable: { thread_id: `durability-test:${randomUUID()}` } };

    // First run crashes in node c (after a and b have checkpointed).
    await expect(graph.invoke({ value: "" }, cfg)).rejects.toThrow(/boom in c/);
    expect(calls).toEqual({ a: 1, b: 1, c: 1 });

    // Resume (null input, same thread): a and b must NOT re-run; c retries.
    const final = await graph.invoke(null, cfg);
    expect(calls.a).toBe(1); // completed node, not re-executed
    expect(calls.b).toBe(1); // completed node, not re-executed
    expect(calls.c).toBe(2); // the failed node retried on resume
    expect(final.value).toBe("done");
    expect(final.steps).toEqual(["a", "b", "c"]);
  });
});
