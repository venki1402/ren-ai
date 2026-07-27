-- CreateEnum
CREATE TYPE "Persona" AS ENUM ('student', 'developer', 'entrepreneur', 'generalist');

-- AlterTable
ALTER TABLE "post_events" ADD COLUMN     "retry_instruction" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboarded_at" TIMESTAMP(3),
ADD COLUMN     "persona" "Persona" NOT NULL DEFAULT 'generalist',
ADD COLUMN     "persona_context" JSONB;
