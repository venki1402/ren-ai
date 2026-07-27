import "server-only";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { getAdapter } from "@/lib/adapters";
import type { OAuthToken } from "@/lib/adapters/types";
import type { PlatformId } from "@/lib/platforms";

// Platform OAuth connection storage (doc Sections 4, 7, 10). Tokens are
// encrypted at rest with AES-256-GCM (lib/crypto) — raw tokens are never
// logged. This is kept deliberately separate from Clerk app login: a `users`
// row can have zero or more `oauth_connections` (Note 10).

// Refresh a token this many ms before it actually expires.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export async function saveConnection(
  userId: string,
  platform: PlatformId,
  token: OAuthToken,
): Promise<void> {
  const data = {
    accessToken: encrypt(token.accessToken),
    refreshToken: token.refreshToken ? encrypt(token.refreshToken) : null,
    expiresAt: token.expiresAt ?? null,
    scopes: token.scopes ?? [],
  };
  await db.oauthConnection.upsert({
    where: { userId_platform: { userId, platform } },
    create: { userId, platform, ...data },
    update: data,
  });
}

export async function isConnected(
  userId: string,
  platform: PlatformId,
): Promise<boolean> {
  const row = await db.oauthConnection.findUnique({
    where: { userId_platform: { userId, platform } },
    select: { id: true },
  });
  return row !== null;
}

export async function deleteConnection(
  userId: string,
  platform: PlatformId,
): Promise<void> {
  await db.oauthConnection.deleteMany({ where: { userId, platform } });
}

/**
 * Load a usable token for a platform, refreshing it in place if it's expired
 * (or about to) and a refresh token is available. Returns null if there's no
 * connection. Decryption happens only here, in the adapter/data layer.
 */
export async function getValidToken(
  userId: string,
  platform: PlatformId,
): Promise<OAuthToken | null> {
  const row = await db.oauthConnection.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (!row) return null;

  let token: OAuthToken = {
    accessToken: decrypt(row.accessToken),
    refreshToken: row.refreshToken ? decrypt(row.refreshToken) : undefined,
    expiresAt: row.expiresAt ?? undefined,
    scopes: row.scopes,
  };

  const expiringSoon =
    token.expiresAt &&
    token.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;

  if (expiringSoon && token.refreshToken) {
    try {
      token = await getAdapter(platform).refreshToken(token);
      await saveConnection(userId, platform, token);
    } catch {
      // Refresh failed — return the existing token; the publish call will
      // surface a clear error if it's truly dead.
    }
  }

  return token;
}
