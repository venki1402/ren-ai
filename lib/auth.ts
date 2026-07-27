import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";

// Bridges Clerk (app login) → our `users` table. A Clerk-authenticated user
// gets exactly one `users` row; platform OAuth lives separately in
// `oauth_connections` and is never conflated with this (Note 10).

export async function getCurrentUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/**
 * Require a signed-in user and return the local `users` row, creating/syncing
 * it from Clerk on first sight. Throws if unauthenticated.
 */
export async function requireUser(): Promise<User> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const existing = await db.user.findUnique({
    where: { clerkUserId: userId },
  });
  if (existing) return existing;

  const cu = await currentUser();
  const email =
    cu?.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId)
      ?.emailAddress ??
    cu?.emailAddresses[0]?.emailAddress ??
    "";
  const name =
    [cu?.firstName, cu?.lastName].filter(Boolean).join(" ").trim() || null;

  return db.user.create({
    data: {
      clerkUserId: userId,
      email,
      name,
      avatarUrl: cu?.imageUrl ?? null,
    },
  });
}
