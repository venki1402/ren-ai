-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('linkedin', 'x');

-- CreateEnum
CREATE TYPE "IdeaSource" AS ENUM ('manual', 'news');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('draft', 'finalized', 'archived');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('generated', 'critiqued', 'rewritten', 'approved', 'rejected', 'posted');

-- CreateEnum
CREATE TYPE "PostAction" AS ENUM ('posted', 'retry', 'discarded');

-- CreateEnum
CREATE TYPE "RetryReason" AS ENUM ('too_salesy', 'weak_hook', 'not_authentic', 'other');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(3),
    "scopes" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" "IdeaSource" NOT NULL,
    "seed_text" TEXT NOT NULL,
    "seed_news_url" TEXT,
    "status" "IdeaStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'generated',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_variants" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "content" TEXT NOT NULL,
    "hook_alternatives" JSONB,
    "score" JSONB,
    "critique_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_events" (
    "id" TEXT NOT NULL,
    "platform_variant_id" TEXT NOT NULL,
    "action" "PostAction" NOT NULL,
    "retry_reason" "RetryReason",
    "external_post_id" TEXT,
    "external_post_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_cache" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "summary" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_connections_user_id_platform_key" ON "oauth_connections"("user_id", "platform");

-- CreateIndex
CREATE INDEX "ideas_user_id_idx" ON "ideas"("user_id");

-- CreateIndex
CREATE INDEX "drafts_idea_id_idx" ON "drafts"("idea_id");

-- CreateIndex
CREATE UNIQUE INDEX "drafts_idea_id_version_key" ON "drafts"("idea_id", "version");

-- CreateIndex
CREATE INDEX "platform_variants_draft_id_idx" ON "platform_variants"("draft_id");

-- CreateIndex
CREATE INDEX "post_events_platform_variant_id_idx" ON "post_events"("platform_variant_id");

-- CreateIndex
CREATE INDEX "news_cache_category_idx" ON "news_cache"("category");

-- AddForeignKey
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_variants" ADD CONSTRAINT "platform_variants_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_events" ADD CONSTRAINT "post_events_platform_variant_id_fkey" FOREIGN KEY ("platform_variant_id") REFERENCES "platform_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
