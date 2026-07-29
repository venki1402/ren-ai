import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/lib/db";
import { computeCostUsd } from "@/lib/ai/observability/pricing";

// Lightweight LLM tracing built on AsyncLocalStorage, so instrumentation is
// non-invasive: wrap a generation in `withTrace(...)` and every model call
// underneath records a Span automatically without threading a context object
// through every function. All persistence is best-effort — a tracing failure
// must never break generation (see `safe`).

interface TraceContext {
  traceId: string;
  // The currently-open span id, so nested calls attach as children (an agent
  // span becomes the parent of the LLM/tool calls it makes).
  parentSpanId?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

/** Swallow and log tracing errors — observability is never load-bearing. */
async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[trace] non-fatal:", (err as Error).message);
    }
    return undefined;
  }
}

const MAX_JSON_CHARS = 4000;
/** Truncate large prompt/response payloads before persisting them. */
function clip(value: unknown): unknown {
  if (value == null) return value;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s.length <= MAX_JSON_CHARS) return value;
  return { truncated: true, preview: s.slice(0, MAX_JSON_CHARS) };
}

export interface TraceHandle {
  id: string;
}

/**
 * Open a trace for a logical run (one generation, one eval case, …). Everything
 * awaited inside `fn` shares the trace via AsyncLocalStorage. The trace is
 * closed (status + cost rollup) when `fn` settles.
 */
export async function withTrace<T>(
  opts: { name: string; userId?: string | null; ideaId?: string | null; metadata?: Record<string, unknown> },
  fn: (trace: TraceHandle) => Promise<T>,
): Promise<T> {
  const created = await safe(() =>
    db.trace.create({
      data: {
        name: opts.name,
        userId: opts.userId ?? null,
        ideaId: opts.ideaId ?? null,
        metadata: (opts.metadata as object) ?? undefined,
      },
      select: { id: true },
    }),
  );

  // If the trace row couldn't be created, still run the work untraced.
  if (!created) return fn({ id: "untraced" });

  const traceId = created.id;
  return storage.run({ traceId }, async () => {
    try {
      const result = await fn({ id: traceId });
      await closeTrace(traceId, "ok");
      return result;
    } catch (err) {
      await closeTrace(traceId, "error");
      throw err;
    }
  });
}

async function closeTrace(traceId: string, status: "ok" | "error") {
  await safe(async () => {
    const agg = await db.span.aggregate({
      where: { traceId },
      _sum: { costUsd: true },
    });
    await db.trace.update({
      where: { id: traceId },
      data: { status, endedAt: new Date(), costUsd: agg._sum.costUsd ?? null },
    });
  });
}

export interface LlmSpanResult {
  model?: string;
  tier?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  output?: unknown;
}

/**
 * Record one instrumented step. Opens a span (child of the current one),
 * runs `fn`, and captures latency, token usage, cost, and errors. Returns
 * `fn`'s value untouched. If no trace is active this is a thin pass-through.
 *
 * For LLM spans, `fn` returns an LlmSpanResult alongside the real value via
 * `extract` so we can read usage without coupling this to the AI SDK types.
 */
export async function withSpan<T>(
  opts: {
    name: string;
    kind: "llm" | "agent" | "tool" | "retrieval" | "embedding" | "function";
    model?: string;
    tier?: string;
    input?: unknown;
  },
  fn: () => Promise<T>,
  extract?: (result: T) => LlmSpanResult,
): Promise<T> {
  const ctx = storage.getStore();
  if (!ctx) return fn(); // untraced context — run directly

  const startedAt = Date.now();
  const span = await safe(() =>
    db.span.create({
      data: {
        traceId: ctx.traceId,
        parentId: ctx.parentSpanId ?? null,
        name: opts.name,
        kind: opts.kind,
        model: opts.model,
        tier: opts.tier,
        input: (clip(opts.input) as object) ?? undefined,
        status: "running",
      },
      select: { id: true },
    }),
  );

  const spanId = span?.id;
  // Nest children under this span while fn runs.
  const childCtx: TraceContext = { traceId: ctx.traceId, parentSpanId: spanId };

  try {
    const result = await storage.run(childCtx, fn);
    const info = extract?.(result);
    const latencyMs = Date.now() - startedAt;
    if (spanId) {
      const cost = computeCostUsd(
        info?.model ?? opts.model,
        info?.usage?.inputTokens,
        info?.usage?.outputTokens,
      );
      await safe(() =>
        db.span.update({
          where: { id: spanId },
          data: {
            status: "ok",
            model: info?.model ?? opts.model,
            tier: info?.tier ?? opts.tier,
            inputTokens: info?.usage?.inputTokens ?? null,
            outputTokens: info?.usage?.outputTokens ?? null,
            totalTokens: info?.usage?.totalTokens ?? null,
            costUsd: cost,
            latencyMs,
            output: (clip(info?.output) as object) ?? undefined,
            endedAt: new Date(),
          },
        }),
      );
    }
    return result;
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    if (spanId) {
      await safe(() =>
        db.span.update({
          where: { id: spanId },
          data: {
            status: "error",
            error: (err as Error).message?.slice(0, 1000),
            latencyMs,
            endedAt: new Date(),
          },
        }),
      );
    }
    throw err;
  }
}

/** True when a trace is currently active on this async context. */
export function isTracing(): boolean {
  return storage.getStore() !== undefined;
}
