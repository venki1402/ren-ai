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

  // Upsert, not create: on the pooled Neon endpoint a brand-new user's row can
  // be missed by the findUnique above if a near-simultaneous request already
  // created it (e.g. a page render followed immediately by a Server Action, as
  // in onboarding). A plain create would then trip the clerkUserId unique
  // constraint (P2002) and 500. Upsert makes first-sight creation idempotent.
  return db.user.upsert({
    where: { clerkUserId: userId },
    update: {},
    create: {
      clerkUserId: userId,
      email,
      name,
      avatarUrl: cu?.imageUrl ?? null,
    },
  });
}
