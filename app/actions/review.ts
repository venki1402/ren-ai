"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { critiqueContent, type GeneratedVariant } from "@/lib/ai/generate";
import { generateVariant } from "@/lib/ai/generate-variant";
import { carryForward, persistDraftVersion } from "@/lib/drafts";
import { profileFromUser } from "@/lib/persona";
import { withTrace } from "@/lib/ai/observability/trace";
import { indexPostedVariant } from "@/lib/ai/ingest";
import { getFeedbackNote } from "@/lib/feedback";
import { getAdapter } from "@/lib/adapters";
import { getValidToken } from "@/lib/oauth";
import type { PostResult } from "@/lib/adapters/types";
import type { RetryReason } from "@prisma/client";

const RETRY_PHRASES: Record<RetryReason, string> = {
  too_salesy: "It felt too salesy.",
  weak_hook: "The hook was weak.",
  not_authentic: "It didn't feel authentic / had AI-tells.",
  other: "The creator wants a different take.",
};

// Load a variant + its draft/idea and confirm the current user owns it. Returns
// the owning user too, since generation/critique is conditioned on their persona.
async function loadOwnedVariant(variantId: string) {
  const user = await requireUser();
  const variant = await db.platformVariant.findUnique({
    where: { id: variantId },
    include: {
      draft: { include: { idea: true, platformVariants: true } },
    },
  });
  if (!variant || variant.draft.idea.userId !== user.id) {
    throw new Error("Not found");
  }
  return { user, variant };
}

// Retry: log the reason (+ any freeform instruction), regenerate this platform
// with the feedback injected, carry the other platform forward unchanged, save
// as a NEW draft version.
export async function retryVariant(
  variantId: string,
  retryReason: RetryReason,
  customInstruction?: string,
): Promise<void> {
  const { user, variant } = await loadOwnedVariant(variantId);
  const idea = variant.draft.idea;
  const instruction = customInstruction?.trim() || null;

  await db.postEvent.create({
    data: {
      platformVariantId: variantId,
      action: "retry",
      retryReason,
      retryInstruction: instruction,
    },
  });

  const priorPattern = (await getFeedbackNote(user.id)) ?? undefined;
  const threadId = `${idea.id}:${variant.platform}:retry:${randomUUID()}`;
  const regenerated = await withTrace(
    {
      name: `retry:${variant.platform}`,
      userId: user.id,
      ideaId: idea.id,
      metadata: { retryReason, hasInstruction: !!instruction, threadId },
    },
    () =>
      generateVariant(idea.seedText, variant.platform, profileFromUser(user), {
        userId: user.id,
        sourceUrl: idea.seedNewsUrl,
        threadId,
        feedback: {
          retryReason: RETRY_PHRASES[retryReason],
          customInstruction: instruction ?? undefined,
          priorPattern,
        },
      }),
  );

  const carried: GeneratedVariant[] = variant.draft.platformVariants
    .filter((v) => v.platform !== variant.platform)
    .map(carryForward);

  await persistDraftVersion(idea.id, [regenerated, ...carried]);
  revalidatePath(`/ideas/${idea.id}`);
}

// Manual edit: save the edited content as a new version, re-critiqued so its
// scores stay meaningful. Other platform carried forward unchanged.
export async function editVariant(
  variantId: string,
  newContent: string,
): Promise<void> {
  const { user, variant } = await loadOwnedVariant(variantId);
  const idea = variant.draft.idea;
  const content = newContent.trim();
  if (!content) throw new Error("Content is required");

  const review = await critiqueContent(
    content,
    variant.platform,
    profileFromUser(user),
  );
  const edited: GeneratedVariant = {
    platform: variant.platform,
    content,
    hookAlternatives: Array.isArray(variant.hookAlternatives)
      ? (variant.hookAlternatives as string[])
      : [],
    score: review.scores,
    critiqueNotes: review.notes,
    autoRewrites: 0,
  };

  const carried: GeneratedVariant[] = variant.draft.platformVariants
    .filter((v) => v.platform !== variant.platform)
    .map(carryForward);

  await persistDraftVersion(idea.id, [edited, ...carried]);
  revalidatePath(`/ideas/${idea.id}`);
}

// Discard: logged, no further action (doc 5.5).
export async function discardVariant(variantId: string): Promise<void> {
  const { variant } = await loadOwnedVariant(variantId);
  await db.postEvent.create({
    data: { platformVariantId: variantId, action: "discarded" },
  });
  revalidatePath(`/ideas/${variant.draft.idea.id}`);
}

// Resolve the publish action for a variant via its platform adapter.
//   - X: always a client action (open the Web Intent).
//   - LinkedIn WITH a connection: publish server-side via the Posts API, log
//     the post_event, and mark the draft posted (no client confirm needed).
//   - LinkedIn WITHOUT a connection: fall back to copy-to-clipboard (Phase 1
//     behavior) so the flow still works before the user connects.
export async function getPublishAction(variantId: string): Promise<PostResult> {
  const { variant } = await loadOwnedVariant(variantId);
  const platform = variant.platform;
  const adapter = getAdapter(platform);

  if (platform === "linkedin") {
    const token = await getValidToken(variant.draft.idea.userId, "linkedin");
    if (!token) {
      // Not connected yet — keep the clipboard fallback.
      return { status: "client_action", action: "copy", text: variant.content };
    }
    const result = await adapter.publish({ content: variant.content, token });
    if (result.status === "published") {
      await db.postEvent.create({
        data: {
          platformVariantId: variantId,
          action: "posted",
          externalPostId: result.externalPostId ?? null,
          externalPostUrl: result.externalPostUrl ?? null,
        },
      });
      await db.draft.update({
        where: { id: variant.draftId },
        data: { status: "posted" },
      });
      // A posted variant is a signal of the user's real voice — index it for
      // future voice-RAG retrieval (best-effort; never blocks publishing).
      await indexPostedVariant(variantId);
      revalidatePath(`/ideas/${variant.draft.idea.id}`);
    }
    return result;
  }

  return adapter.publish({ content: variant.content });
}

// Optimistically log a post (there's no callback from Web Intents). Called
// when the user confirms via the "Did this post? ✓" toggle.
export async function confirmPosted(
  variantId: string,
  externalPostUrl?: string,
): Promise<void> {
  const { variant } = await loadOwnedVariant(variantId);
  await db.postEvent.create({
    data: {
      platformVariantId: variantId,
      action: "posted",
      externalPostUrl: externalPostUrl ?? null,
    },
  });
  await db.draft.update({
    where: { id: variant.draftId },
    data: { status: "posted" },
  });
  await indexPostedVariant(variantId); // voice index (best-effort)
  revalidatePath(`/ideas/${variant.draft.idea.id}`);
}
