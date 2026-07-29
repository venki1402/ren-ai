import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { embed, embedMany, toVectorLiteral } from "@/lib/ai/embeddings";
import { chunkText } from "@/lib/ai/text";
import { safeFetch, sanitizeRetrieved } from "@/lib/ai/safety";
import { overallScore, parseScore } from "@/lib/score";

// Ingestion into the two RAG indexes. Both write the vector column via raw SQL
// (Prisma can't). All entry points are best-effort — an indexing failure must
// never break the user action that triggered it (publishing a post, generating
// a draft), so everything is wrapped and logged, never thrown.

// ─── Voice index ────────────────────────────────────────────────────────────

/**
 * Index one accepted/posted PlatformVariant so it can be retrieved later as a
 * voice few-shot exemplar. Idempotent per variant (ON CONFLICT upsert).
 */
export async function indexPostedVariant(platformVariantId: string): Promise<void> {
  try {
    const variant = await db.platformVariant.findUnique({
      where: { id: platformVariantId },
      include: { draft: { include: { idea: true } } },
    });
    if (!variant) return;

    const userId = variant.draft.idea.userId;
    const parsed = parseScore(variant.score);
    const score = parsed ? overallScore(parsed) : null;
    const vec = toVectorLiteral(await embed(variant.content));

    await db.$executeRawUnsafe(
      `INSERT INTO post_embeddings
         (id, user_id, platform_variant_id, platform, content, score, embedding)
       VALUES ($1, $2, $3, $4::"Platform", $5, $6, $7::vector)
       ON CONFLICT (platform_variant_id) DO UPDATE
         SET content = EXCLUDED.content,
             score = EXCLUDED.score,
             embedding = EXCLUDED.embedding,
             created_at = now()`,
      randomUUID(),
      userId,
      platformVariantId,
      variant.platform,
      variant.content,
      score,
      vec,
    );
  } catch (err) {
    console.warn("[ingest] voice index failed:", (err as Error).message);
  }
}

// ─── Grounding index ─────────────────────────────────────────────────────────

/**
 * Fetch, chunk, and embed a source article so news-seeded posts can be grounded
 * in real facts + cited. Skips if the URL is already indexed. Best-effort.
 */
export async function indexGroundingSource(sourceUrl: string): Promise<void> {
  try {
    const already = await db.documentChunk.count({ where: { sourceUrl } });
    if (already > 0) return;

    const { title, text } = await fetchArticleText(sourceUrl);
    if (text.length < 200) return; // not enough real content to ground anything

    const chunks = chunkText(text);
    const vecs = await embedMany(chunks);

    // One multi-row insert keeps it to a single round-trip.
    const values: string[] = [];
    const params: unknown[] = [];
    chunks.forEach((content, i) => {
      const b = i * 6;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::vector)`);
      params.push(randomUUID(), sourceUrl, title, i, content, toVectorLiteral(vecs[i]));
    });
    await db.$executeRawUnsafe(
      `INSERT INTO document_chunks (id, source_url, title, chunk_index, content, embedding)
       VALUES ${values.join(", ")}`,
      ...params,
    );
  } catch (err) {
    console.warn("[ingest] grounding index failed:", (err as Error).message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fetch a URL and extract a plain-text approximation of the article body. */
async function fetchArticleText(
  url: string,
): Promise<{ title: string | null; text: string }> {
  // SSRF-guarded fetch (no private hosts, validated redirects, size cap).
  const html = await safeFetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; RenBot/1.0)" },
  });
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 300) : null;
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  // Neutralize injection phrasing before it reaches the embedding + prompt path.
  return { title, text: sanitizeRetrieved(text) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
