import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { embed, toVectorLiteral } from "@/lib/ai/embeddings";
import { retrieveGrounding } from "@/lib/ai/retrieval";
import { judgeFaithfulness } from "./harness";
import type { Citation } from "@/lib/ai/agents/types";

// Retrieval-quality evals — measure the RETRIEVER, not the generated post.
//   - recall@k + MRR over a seeded mini-corpus (embeddings + pgvector, no LLM).
//   - faithfulness judge discriminates a grounded post from a fabricated one.
// Gated by RUN_EVALS (needs DATABASE_URL; the recall part needs no API key).

const RUN = process.env.RUN_EVALS === "1";
const NS = `test://retrieval/${randomUUID()}`;

// Deliberately distinctive content so the matching query outranks any real
// chunks already in the index.
const CORPUS = [
  { url: `${NS}/quokka`, text: "The quokka is a small marsupial native to Rottnest Island, famous for its cheerful facial expression." },
  { url: `${NS}/obsidian`, text: "Obsidian is a naturally occurring volcanic glass formed when felsic lava cools rapidly; knappers prize it for razor-sharp edges." },
  { url: `${NS}/zither`, text: "The zither is a stringed instrument with many strings stretched across a flat soundboard, tuned with pegs." },
];
const QUERIES = [
  { q: "cheerful marsupial from Rottnest Island", expect: `${NS}/quokka` },
  { q: "volcanic glass used for sharp blades", expect: `${NS}/obsidian` },
  { q: "flat stringed instrument tuned with pegs", expect: `${NS}/zither` },
];

describe.skipIf(!RUN)("retrieval quality", () => {
  beforeAll(async () => {
    for (const doc of CORPUS) {
      const vec = toVectorLiteral(await embed(doc.text));
      await db.$executeRawUnsafe(
        `INSERT INTO document_chunks (id, source_url, title, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        randomUUID(),
        doc.url,
        "retrieval-eval",
        0,
        doc.text,
        vec,
      );
    }
  });

  afterAll(async () => {
    await db.$executeRawUnsafe(`DELETE FROM document_chunks WHERE source_url LIKE $1`, `${NS}%`);
  });

  it("recall@3 and MRR over the seeded corpus", async () => {
    const K = 3;
    let found = 0;
    let rrSum = 0;
    for (const { q, expect: expectedUrl } of QUERIES) {
      const hits = await retrieveGrounding(q, { k: K });
      const rank = hits.findIndex((h) => h.sourceUrl === expectedUrl) + 1; // 0 → not found
      if (rank > 0) {
        found += 1;
        rrSum += 1 / rank;
      }
    }
    const recall = found / QUERIES.length;
    const mrr = rrSum / QUERIES.length;
    console.log(`\n  recall@${K}=${recall.toFixed(2)}  MRR=${mrr.toFixed(2)}\n`);
    expect(recall).toBe(1); // every query's doc retrieved in top-3
    expect(mrr).toBeGreaterThanOrEqual(0.8); // and usually at rank 1
  });

  it("faithfulness judge scores a grounded post above a fabricated one", async () => {
    const citations: Citation[] = [
      {
        sourceUrl: "test://groq",
        title: "Groq benchmark",
        snippet:
          "In an independent benchmark, Groq's LPU reached about 300 tokens/second on Llama-2 70B.",
      },
    ];
    const grounded = "Groq's LPU hit roughly 300 tokens/sec on Llama-2 70B in independent tests.";
    const fabricated =
      "Groq's LPU runs at 5000 tokens/sec and already powers 90% of all AI startups.";

    const [fg, ff] = await Promise.all([
      judgeFaithfulness(grounded, citations),
      judgeFaithfulness(fabricated, citations),
    ]);
    console.log(`\n  faithfulness grounded=${fg.toFixed(2)}  fabricated=${ff.toFixed(2)}\n`);
    expect(fg).toBeGreaterThan(ff);
    expect(fg).toBeGreaterThanOrEqual(0.6);
  });
});
