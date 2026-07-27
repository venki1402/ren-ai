import { db } from "@/lib/db";

// Read helpers for Server Components. Mutations live in app/actions/*.

export async function getIdeasForUser(userId: string) {
  return db.idea.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      drafts: {
        orderBy: { version: "desc" },
        take: 1,
        include: { platformVariants: true },
      },
    },
  });
}

export async function getIdeaDetail(ideaId: string, userId: string) {
  return db.idea.findFirst({
    where: { id: ideaId, userId },
    include: {
      drafts: {
        orderBy: { version: "desc" },
        include: {
          platformVariants: {
            orderBy: { platform: "asc" },
            include: { postEvents: { orderBy: { createdAt: "desc" } } },
          },
        },
      },
    },
  });
}

export type IdeaDetail = NonNullable<Awaited<ReturnType<typeof getIdeaDetail>>>;
export type IdeaListItem = Awaited<ReturnType<typeof getIdeasForUser>>[number];
