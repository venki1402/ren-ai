import { traceable } from "langsmith/traceable";

// LangSmith tracing, enabled purely by env — with LANGSMITH_TRACING unset or no
// API key, everything here is a zero-cost passthrough that sends nothing, so it
// is safe to leave wired in every environment.
//
// LangGraph.js auto-emits the graph + per-node run tree to LangSmith when
// tracing is on (no code needed — it reads the env). This helper adds the piece
// LangGraph can't see: nested `llm` runs with token usage for our AI-SDK (Groq)
// calls, so a full generation shows up in LangSmith as
//   graph → strategist / researcher / debate / factcheck → llm(draft/critique/…).

export function langsmithEnabled(): boolean {
  return (
    /^(1|true|on)$/i.test(process.env.LANGSMITH_TRACING ?? "") &&
    !!process.env.LANGSMITH_API_KEY
  );
}

export interface LlmResult<T> {
  result: T;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  model?: string;
}

/**
 * Wrap an LLM-producing thunk as a LangSmith `llm` run carrying token usage.
 * The thunk returns `{ result, usage, model }`; we report `usage_metadata` to
 * LangSmith and hand back just `result`. No-op passthrough when tracing is off
 * (runs the thunk exactly once either way). Never throws on tracing failure.
 */
export async function traceLLM<T>(
  name: string,
  thunk: () => Promise<LlmResult<T>>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  if (!langsmithEnabled()) return (await thunk()).result;

  const traced = traceable(
    async () => {
      const { result, usage, model } = await thunk();
      return {
        output: result,
        model,
        usage_metadata: usage
          ? {
              input_tokens: usage.inputTokens ?? 0,
              output_tokens: usage.outputTokens ?? 0,
              total_tokens: usage.totalTokens ?? 0,
            }
          : undefined,
      };
    },
    { name, run_type: "llm", metadata },
  );

  try {
    const out = (await traced()) as { output: T };
    return out.output;
  } catch (err) {
    // A LangSmith/export failure must never break generation — fall back.
    console.warn("[langsmith] tracing failed, running untraced:", (err as Error).message);
    return (await thunk()).result;
  }
}
