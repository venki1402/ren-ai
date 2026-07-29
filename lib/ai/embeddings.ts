import { withSpan } from "@/lib/ai/observability/trace";

// Text embeddings. Default provider runs `all-MiniLM-L6-v2` locally in-process
// via Transformers.js — no API key, no per-call cost, works offline. It's
// deliberately behind a small interface so a hosted provider (OpenAI / Gemini)
// can be swapped in later by changing `embedRaw` + EMBEDDING_DIM (a hosted
// model has a different dimension, so that also means a schema migration).
//
// NOTE: local models are awkward on serverless (model download + cold start +
// bundle size). For a Vercel deploy, switch to a hosted embedder. Ingestion
// scripts and the dev server run fine locally.

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384; // must match the vector(N) column in the schema

// Lazily construct the pipeline once (loading the model is expensive). Typed
// loosely to avoid pulling Transformers.js types into every consumer.
let extractorPromise: Promise<unknown> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import("@xenova/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", EMBEDDING_MODEL),
    );
  }
  return extractorPromise as Promise<
    (
      input: string | string[],
      opts: { pooling: "mean"; normalize: boolean },
    ) => Promise<{ data: Float32Array; tolist: () => number[][] }>
  >;
}

/** Embed a single string into a unit-normalized vector (cosine-ready). */
export async function embed(text: string): Promise<number[]> {
  const [vec] = await embedMany([text]);
  return vec;
}

/** Embed many strings in one pass. Returns one vector per input, in order. */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return withSpan(
    {
      name: "embed",
      kind: "embedding",
      model: EMBEDDING_MODEL,
      input: { count: texts.length },
    },
    async () => {
      const extractor = await getExtractor();
      // mean pooling + L2 normalize → cosine similarity == dot product.
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      return output.tolist();
    },
  );
}

/** Serialize a vector into the pgvector text literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
