-- AlterTable
ALTER TABLE "platform_variants" ADD COLUMN     "citations" JSONB;

-- NOTE: Prisma's diff also wanted to DROP the pgvector HNSW indexes
-- (post_embeddings_embedding_hnsw, document_chunks_embedding_hnsw) because it
-- can't represent vector index types in the schema. Those DROPs were removed by
-- hand — the indexes must stay. Re-check future generated migrations for the
-- same spurious drop.
