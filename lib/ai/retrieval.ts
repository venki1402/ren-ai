import { db } from "@/lib/db";
import { embed, toVectorLiteral } from "@/lib/ai/embeddings";
import { withSpan } from "@/lib/ai/observability/trace";
import type { PlatformId } from "@/lib/platforms";

// Vector retrieval over the two pgvector indexes. Prisma can't query vector
// columns, so these use raw SQL with the `<=>` cosine-distance operator; since
// embeddings are L2-normalized, `similarity = 1 - distance` ∈ [0, 1]. The HNSW
// indexes (see the rag_pgvector migration) make this an approximate KNN.
//
// Signatures are intentionally tool-friendly — the multi-agent layer wraps them
// as agent tools (a Researcher's retrieval/grounding tools).

export interface VoiceExemplar {
  platformVariantId: string;
  platform: PlatformId;
  content: string;
  score: number | null;
  similarity: number;
}

export interface GroundingChunk {
  sourceUrl: string;
  title: string | null;
  chunkIndex: number;
  content: string;
  similarity: number;
}

/**
 * Voice RAG: the user's OWN past accepted/posted posts most similar to the seed
 * idea, to use as few-shot exemplars so drafts match their established voice.
 * Returns [] for a cold-start user with no indexed posts (caller falls back to
 * persona-only conditioning).
 */
export async function retrieveVoiceExemplars(
  userId: string,
  seedText: string,
  k = 3,
): Promise<VoiceExemplar[]> {
  return withSpan(
    { name: "retrieve:voice", kind: "retrieval", input: { userId, k } },
    async () => {
      const vec = toVectorLiteral(await embed(seedText));
      const rows = await db.$queryRawUnsafe<
        {
          platform_variant_id: string;
          platform: PlatformId;
          content: string;
          score: number | null;
          similarity: number;
        }[]
      >(
        `SELECT platform_variant_id, platform, content, score,
                1 - (embedding <=> $1::vector) AS similarity
         FROM post_embeddings
         WHERE user_id = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        vec,
        userId,
        k,
      );
      return rows.map((r) => ({
        platformVariantId: r.platform_variant_id,
        platform: r.platform,
        content: r.content,
        score: r.score,
        similarity: Number(r.similarity),
      }));
    },
  );
}

/**
 * Grounding RAG: chunks of real source material most relevant to a query,
 * optionally scoped to a single source URL. Used to ground news-seeded posts in
 * facts + produce citations. Returns [] if nothing is indexed.
 */
export async function retrieveGrounding(
  query: string,
  opts: { k?: number; sourceUrl?: string } = {},
): Promise<GroundingChunk[]> {
  const { k = 5, sourceUrl } = opts;
  return withSpan(
    { name: "retrieve:grounding", kind: "retrieval", input: { query, k, sourceUrl } },
    async () => {
      const vec = toVectorLiteral(await embed(query));
      const rows = sourceUrl
        ? await db.$queryRawUnsafe<GroundingRow[]>(
            `SELECT source_url, title, chunk_index, content,
                    1 - (embedding <=> $1::vector) AS similarity
             FROM document_chunks
             WHERE source_url = $2
             ORDER BY embedding <=> $1::vector
             LIMIT $3`,
            vec,
            sourceUrl,
            k,
          )
        : await db.$queryRawUnsafe<GroundingRow[]>(
            `SELECT source_url, title, chunk_index, content,
                    1 - (embedding <=> $1::vector) AS similarity
             FROM document_chunks
             ORDER BY embedding <=> $1::vector
             LIMIT $2`,
            vec,
            k,
          );
      return rows.map((r) => ({
        sourceUrl: r.source_url,
        title: r.title,
        chunkIndex: r.chunk_index,
        content: r.content,
        similarity: Number(r.similarity),
      }));
    },
  );
}

interface GroundingRow {
  source_url: string;
  title: string | null;
  chunk_index: number;
  content: string;
  similarity: number;
}
