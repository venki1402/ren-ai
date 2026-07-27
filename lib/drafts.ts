import { db } from "@/lib/db";
import type { GeneratedVariant } from "@/lib/ai/generate";
import type { RubricScore } from "@/lib/ai/rubric";
import type { Prisma } from "@prisma/client";

// Persists one new, versioned Draft with a PlatformVariant per generated
// variant. Every regenerate creates a NEW version — never an overwrite
// (doc Note 10, hard requirement).
export async function persistDraftVersion(
  ideaId: string,
  variants: GeneratedVariant[],
) {
  const last = await db.draft.findFirst({
    where: { ideaId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  return db.draft.create({
    data: {
      ideaId,
      version,
      status: "critiqued",
      platformVariants: {
        create: variants.map((v) => ({
          platform: v.platform,
          content: v.content,
          hookAlternatives: v.hookAlternatives as Prisma.InputJsonValue,
          score: v.score as unknown as Prisma.InputJsonValue,
          critiqueNotes: v.critiqueNotes,
        })),
      },
    },
    include: { platformVariants: true },
  });
}

// Turn a stored PlatformVariant back into the GeneratedVariant shape so an
// untouched platform can be carried forward into a new version unchanged.
export function carryForward(v: {
  platform: "linkedin" | "x";
  content: string;
  hookAlternatives: unknown;
  score: unknown;
  critiqueNotes: string | null;
}): GeneratedVariant {
  return {
    platform: v.platform,
    content: v.content,
    hookAlternatives: Array.isArray(v.hookAlternatives)
      ? (v.hookAlternatives as string[])
      : [],
    score: (v.score ?? {}) as RubricScore,
    critiqueNotes: v.critiqueNotes ?? "",
    autoRewrites: 0,
  };
}
