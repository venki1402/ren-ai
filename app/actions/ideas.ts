"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { generateVariant } from "@/lib/ai/generate-variant";
import { resumeGenerationGraph } from "@/lib/ai/agents/graph";
import { carryForward, persistDraftVersion } from "@/lib/drafts";
import { profileFromUser } from "@/lib/persona";
import { withTrace } from "@/lib/ai/observability/trace";
import { indexGroundingSource } from "@/lib/ai/ingest";
import { getFeedbackNote } from "@/lib/feedback";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";

// Create a brainstorm idea (manual seed or news-seeded). Returns the idea id.
export async function createIdea(formData: FormData): Promise<void> {
  const user = await requireUser();
  const seedText = String(formData.get("seedText") ?? "").trim();
  const seedNewsUrl = String(formData.get("seedNewsUrl") ?? "").trim() || null;
  if (!seedText) throw new Error("Seed text is required");

  const idea = await db.idea.create({
    data: {
      userId: user.id,
      source: seedNewsUrl ? "news" : "manual",
      seedText,
      seedNewsUrl,
      status: "draft",
    },
  });

  revalidatePath("/");
  redirect(`/ideas/${idea.id}`);
}

// Update the raw idea while iterating on angle/tone before locking it in.
export async function updateIdeaSeed(
  ideaId: string,
  seedText: string,
): Promise<void> {
  const user = await requireUser();
  await db.idea.update({
    where: { id: ideaId, userId: user.id },
    data: { seedText: seedText.trim() },
  });
  revalidatePath(`/ideas/${ideaId}`);
}

// Finalize the idea and fan out generation to both platforms in parallel
// (Server Action + Promise.all — no Inngest in Phase 1). Persists a versioned
// draft with one critiqued variant per platform.
export async function finalizeAndGenerate(ideaId: string): Promise<void> {
  const user = await requireUser();

  const idea = await db.idea.findFirst({
    where: { id: ideaId, userId: user.id },
  });
  if (!idea) throw new Error("Idea not found");

  await db.idea.update({
    where: { id: idea.id },
    data: { status: "finalized" },
  });

  // For a news-seeded idea, ingest the source article into the grounding index
  // (idempotent, best-effort) so the generation pipeline can ground + cite it.
  if (idea.seedNewsUrl) {
    await indexGroundingSource(idea.seedNewsUrl);
  }

  const profile = profileFromUser(user);
  // Feed the creator's recurring rejection patterns back into generation.
  const priorPattern = (await getFeedbackNote(user.id)) ?? undefined;
  // Stable per-platform thread ids → a crashed run is resumable from its last
  // checkpoint via resumeGeneration(). Recorded in the trace so the id survives.
  const threadIds: Record<string, string> = Object.fromEntries(
    PLATFORMS.map((p) => [p, `${idea.id}:${p}:${randomUUID()}`]),
  );
  const variants = await withTrace(
    {
      name: "generate:idea",
      userId: user.id,
      ideaId: idea.id,
      metadata: { platforms: PLATFORMS, threadIds },
    },
    () =>
      Promise.all(
        PLATFORMS.map((platform) =>
          generateVariant(idea.seedText, platform, profile, {
            userId: user.id,
            sourceUrl: idea.seedNewsUrl,
            threadId: threadIds[platform],
            feedback: priorPattern ? { priorPattern } : undefined,
          }),
        ),
      ),
  );

  await persistDraftVersion(idea.id, variants);

  revalidatePath(`/ideas/${ideaId}`);
  redirect(`/ideas/${ideaId}`);
}

// Resume a generation that crashed/timed out mid-run, continuing from its last
// LangGraph checkpoint instead of restarting. `threadId` comes from the trace
// metadata of the failed run. Persists the resumed platform as a new draft
// version, carrying the other platform forward from the latest draft if present.
export async function resumeGeneration(
  ideaId: string,
  threadId: string,
  platform: PlatformId,
): Promise<void> {
  const user = await requireUser();
  const idea = await db.idea.findFirst({
    where: { id: ideaId, userId: user.id },
    include: {
      drafts: { orderBy: { version: "desc" }, take: 1, include: { platformVariants: true } },
    },
  });
  if (!idea) throw new Error("Idea not found");

  const resumed = await withTrace(
    { name: `resume:${platform}`, userId: user.id, ideaId, metadata: { threadId } },
    () => resumeGenerationGraph(threadId, platform),
  );

  const carried = (idea.drafts[0]?.platformVariants ?? [])
    .filter((v) => v.platform !== platform)
    .map(carryForward);

  await persistDraftVersion(ideaId, [resumed, ...carried]);
  revalidatePath(`/ideas/${ideaId}`);
}
