// Approximate Groq per-token pricing (USD per 1M tokens), used to attribute a
// cost to every traced LLM call. These are best-effort public list prices and
// are easy to update — cost is for relative comparison in traces/evals, not
// billing. Unknown models fall back to zero cost (still traced for tokens).

export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}

const PRICES: Record<string, ModelPrice> = {
  "openai/gpt-oss-120b": { inputPerM: 0.15, outputPerM: 0.75 },
  "openai/gpt-oss-20b": { inputPerM: 0.1, outputPerM: 0.5 },
  "llama-3.3-70b-versatile": { inputPerM: 0.59, outputPerM: 0.79 },
  // Embeddings (OpenAI) — priced per input token only.
  "text-embedding-3-small": { inputPerM: 0.02, outputPerM: 0 },
  "text-embedding-3-large": { inputPerM: 0.13, outputPerM: 0 },
};

/** Cost in USD for a call, or null if the model's price is unknown. */
export function computeCostUsd(
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | null {
  if (!model) return null;
  const price = PRICES[model];
  if (!price) return null;
  const inCost = ((inputTokens ?? 0) / 1_000_000) * price.inputPerM;
  const outCost = ((outputTokens ?? 0) / 1_000_000) * price.outputPerM;
  return inCost + outCost;
}
