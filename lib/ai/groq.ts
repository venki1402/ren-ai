import { createGroq } from "@ai-sdk/groq";
import {
  APICallError,
  RetryError,
  generateObject,
  generateText,
  streamText,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { withSpan } from "@/lib/ai/observability/trace";
import { traceLLM } from "@/lib/ai/observability/langsmith";

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

// Model-agnostic Groq wrapper (doc Section 2 & Note 10). Nothing here hardcodes
// a model — callers pass a ModelTier so we can route drafting/critique to the
// primary model and lighter rewrite passes to the secondary one, using their
// separate per-model rate-limit pools.

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

export type ModelTier = "primary" | "light";

/** Resolve a tier to a concrete Groq model id (configurable via env). */
export function modelFor(tier: ModelTier): LanguageModel {
  return groq(modelIdFor(tier));
}

export function modelIdFor(tier: ModelTier): string {
  // Defaults must be models that support Groq's `json_schema` response format,
  // since completeObject() is on the critical path (see JSON_MODE_FALLBACK).
  return tier === "light"
    ? process.env.GROQ_MODEL_LIGHT ?? "openai/gpt-oss-20b"
    : process.env.GROQ_MODEL_PRIMARY ?? "openai/gpt-oss-120b";
}

type BaseArgs = {
  tier?: ModelTier;
  system?: string;
  prompt: string;
  temperature?: number;
  label?: string; // names the trace span (e.g. "plan", "draft", "critique")
};

// ─── Rate-limit handling ──────────────────────────────────────────────────
// Groq's free tier has small per-model TPM ceilings (e.g. gpt-oss-20b is only
// 8000 TPM), so a parallel draft fan-out can trip a 429. The AI SDK's built-in
// retry uses a fixed backoff that ignores Groq's own "try again in Xs" hint, so
// we disable it (maxRetries: 0 on each call) and retry here instead — waiting
// exactly as long as Groq asks. Routing across two models (Note 10) already
// spreads load across separate pools; this covers the remaining bursts.

const RATE_LIMIT_MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Unwrap the AI SDK's RetryError to get at the underlying provider error. */
function rootError(error: unknown): unknown {
  return error instanceof RetryError ? (error.lastError ?? error) : error;
}

function isRateLimitError(error: unknown): boolean {
  const e = rootError(error);
  return (
    APICallError.isInstance(e) &&
    (e.statusCode === 429 || /rate limit/i.test(e.message))
  );
}

/** How long to wait before retrying a 429, from the header or Groq's message. */
function retryAfterMs(error: unknown): number {
  const e = rootError(error);
  if (APICallError.isInstance(e)) {
    const header = e.responseHeaders?.["retry-after"];
    const headerSecs = header ? Number(header) : NaN;
    if (!Number.isNaN(headerSecs)) {
      return Math.min(headerSecs * 1000, MAX_BACKOFF_MS);
    }
    // Groq embeds the wait in the message, e.g. "try again in 3.3075s".
    const m = e.message.match(/try again in ([\d.]+)\s*s/i);
    if (m) return Math.min(Math.ceil(parseFloat(m[1]) * 1000), MAX_BACKOFF_MS);
  }
  return 2000;
}

/** Run an AI SDK call, retrying rate-limit (429) errors with Groq's suggested wait. */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error)) throw rootError(error);
      lastError = error;
      if (attempt === RATE_LIMIT_MAX_RETRIES) break;
      // +250ms per attempt of jitter so parallel calls don't all wake together.
      await sleep(retryAfterMs(error) + 250 * attempt);
    }
  }
  throw rootError(lastError);
}

/** One-shot text completion. */
export async function complete({
  tier = "primary",
  system,
  prompt,
  temperature,
  label,
}: BaseArgs): Promise<string> {
  const model = modelIdFor(tier);
  const spanName = label ?? `llm:${tier}`;
  const rich = await withSpan(
    { name: spanName, kind: "llm", tier, model, input: { system, prompt } },
    () =>
      traceLLM(
        spanName,
        async () => {
          const { text, usage } = await withRateLimitRetry(() =>
            generateText({
              model: modelFor(tier),
              system,
              prompt,
              temperature,
              maxRetries: 0,
            }),
          );
          return { result: { text, usage: usage as TokenUsage }, usage: usage as TokenUsage, model };
        },
        { tier },
      ),
    (r) => ({ model, tier, usage: r.usage, output: r.text }),
  );
  return rich.text;
}

/** Streaming text completion — returns a text stream for progressive reveal. */
export function completeStream({
  tier = "primary",
  system,
  prompt,
  temperature,
}: BaseArgs) {
  return streamText({
    model: modelFor(tier),
    system,
    prompt,
    temperature,
  });
}

// ─── Structured-output robustness ─────────────────────────────────────────
// Two ways Groq's native `response_format: json_schema` fails us, both of
// which used to surface as an unhandled AI_APICallError mid-render:
//
//   1. Structural — only some models accept json_schema at all (the gpt-oss
//      family does; llama/qwen/compound only do plain JSON mode). This wrapper
//      is deliberately model-agnostic, so it can't assume a capable model.
//   2. Intermittent — a capable-but-small model occasionally emits JSON that
//      fails Groq's own strict check (e.g. gpt-oss-20b leaking the schema's
//      `properties`/`required` keys into its answer). Groq returns this as a
//      NON-retryable 400, so the AI SDK will not retry it.
//
// Both fall back to JSON-object mode, which is more forgiving: the AI SDK
// parses and Zod-validates client-side, and Zod strips unknown keys instead of
// rejecting the whole response. The AI SDK does NOT inject the schema into the
// prompt itself, so the fallback has to supply it — given only "reply in JSON"
// the model invents its own field names and validation fails anyway.
//
// A structural failure is cached per model id (it will never succeed); an
// intermittent one is not (the next call usually works).
const jsonSchemaUnsupported = new Set<string>();

function isJsonSchemaUnsupportedError(error: unknown): boolean {
  return (
    APICallError.isInstance(error) &&
    /does not support response format .?json_schema/i.test(error.message)
  );
}

/** Model returned JSON that failed Groq's strict schema check (flaky, not fatal). */
function isJsonValidateFailedError(error: unknown): boolean {
  return (
    APICallError.isInstance(error) &&
    (/json_validate_failed/i.test(error.responseBody ?? "") ||
      /Generated JSON does not match the expected schema/i.test(error.message) ||
      /Failed to validate JSON/i.test(error.message))
  );
}

function schemaInstruction(schema: z.ZodType<unknown>): string {
  const json = JSON.stringify(z.toJSONSchema(schema), null, 2);
  return [
    "Respond with a single JSON object and nothing else — no prose, no",
    "markdown fences. It must validate against this JSON Schema exactly,",
    "using these property names verbatim:",
    "",
    json,
  ].join("\n");
}

/** Pull the first JSON object out of a model reply (tolerates fences / prose). */
function extractJson(text: string): unknown {
  let t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

/** Structured completion validated against a Zod schema (used by critique). */
export async function completeObject<T>({
  tier = "primary",
  system,
  prompt,
  schema,
  temperature,
  label,
}: BaseArgs & { schema: z.ZodType<T> }): Promise<T> {
  const modelId = modelIdFor(tier);
  const spanName = label ?? `llm:${tier}`;
  const rich = await withSpan(
    { name: spanName, kind: "llm", tier, model: modelId, input: { system, prompt } },
    () =>
      traceLLM(
        spanName,
        async () => {
          const r = await runCompleteObject({ modelId, system, prompt, schema, temperature });
          return { result: r, usage: r.usage, model: modelId };
        },
        { tier },
      ),
    (r) => ({ model: modelId, tier, usage: r.usage, output: r.object }),
  );
  return rich.object;
}

/** The un-instrumented body of completeObject: native json_schema with a
 * plain-text JSON-mode fallback. Returns the parsed object plus token usage. */
async function runCompleteObject<T>({
  modelId,
  system,
  prompt,
  schema,
  temperature,
}: {
  modelId: string;
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
}): Promise<{ object: T; usage?: TokenUsage }> {
  if (!jsonSchemaUnsupported.has(modelId)) {
    try {
      const { object, usage } = await withRateLimitRetry(() =>
        generateObject({
          model: groq(modelId),
          system,
          prompt,
          schema,
          temperature,
          maxRetries: 0,
        }),
      );
      return { object, usage: usage as TokenUsage };
    } catch (error) {
      if (isJsonSchemaUnsupportedError(error)) {
        jsonSchemaUnsupported.add(modelId);
      } else if (!isJsonValidateFailedError(error)) {
        throw error;
      }
      // json_validate_failed → fall through to the plain-text fallback below.
    }
  }

  // Fallback: plain-text generation, then parse + Zod-validate ourselves. We
  // deliberately do NOT use generateObject here — that re-triggers Groq's
  // server-side json_schema validation (the `structuredOutputs: false` provider
  // option isn't honored reliably), which is the very check that just failed.
  // Zod strips unknown keys instead of rejecting the whole reply, so it's far
  // more forgiving. Retried once since json failures are intermittent.
  const fallbackPrompt = `${prompt}\n\n${schemaInstruction(schema)}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, usage } = await withRateLimitRetry(() =>
      generateText({
        model: groq(modelId),
        system,
        prompt: fallbackPrompt,
        temperature,
        maxRetries: 0,
      }),
    );
    try {
      return { object: schema.parse(extractJson(text)), usage: usage as TokenUsage };
    } catch (error) {
      lastError = error; // malformed JSON or Zod mismatch — try once more
    }
  }
  throw lastError;
}
