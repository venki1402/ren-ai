-- CreateTable
CREATE TABLE "traces" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "idea_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "metadata" JSONB,
    "cost_usd" DECIMAL(12,6),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spans" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT,
    "tier" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "cost_usd" DECIMAL(12,6),
    "latency_ms" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error" TEXT,
    "input" JSONB,
    "output" JSONB,
    "metadata" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "spans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "traces_user_id_idx" ON "traces"("user_id");

-- CreateIndex
CREATE INDEX "traces_idea_id_idx" ON "traces"("idea_id");

-- CreateIndex
CREATE INDEX "traces_name_idx" ON "traces"("name");

-- CreateIndex
CREATE INDEX "spans_trace_id_idx" ON "spans"("trace_id");

-- CreateIndex
CREATE INDEX "spans_parent_id_idx" ON "spans"("parent_id");

-- AddForeignKey
ALTER TABLE "spans" ADD CONSTRAINT "spans_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "traces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
