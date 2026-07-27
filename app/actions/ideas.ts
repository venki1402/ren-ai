"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { generatePlatformVariant } from "@/lib/ai/generate";
import { persistDraftVersion } from "@/lib/drafts";
import { PLATFORMS } from "@/lib/platforms";

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

  const variants = await Promise.all(
    PLATFORMS.map((platform) =>
      generatePlatformVariant(idea.seedText, platform),
    ),
  );

  await persistDraftVersion(idea.id, variants);

  revalidatePath(`/ideas/${ideaId}`);
  redirect(`/ideas/${ideaId}`);
}
