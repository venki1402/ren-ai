-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "post_embeddings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform_variant_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "content" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "embedding" vector(384) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "title" TEXT,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(384) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_embeddings_platform_variant_id_key" ON "post_embeddings"("platform_variant_id");

-- CreateIndex
CREATE INDEX "post_embeddings_user_id_idx" ON "post_embeddings"("user_id");

-- CreateIndex
CREATE INDEX "document_chunks_source_url_idx" ON "document_chunks"("source_url");

-- AddForeignKey
ALTER TABLE "post_embeddings" ADD CONSTRAINT "post_embeddings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_embeddings" ADD CONSTRAINT "post_embeddings_platform_variant_id_fkey" FOREIGN KEY ("platform_variant_id") REFERENCES "platform_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HNSW cosine indexes for approximate KNN (added manually — Prisma has no
-- vector index type). Embeddings are L2-normalized, so cosine distance ranks
-- identically to inner product. Queried with the `<=>` operator.
CREATE INDEX "post_embeddings_embedding_hnsw" ON "post_embeddings" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "document_chunks_embedding_hnsw" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
