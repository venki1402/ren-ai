import type { PlatformId } from "@/lib/platforms";
import {
  AdapterNotSupportedError,
  type OAuthToken,
  type PlatformAdapter,
  type PostResult,
  type PublishInput,
} from "@/lib/adapters/types";

// LinkedIn adapter (doc Section 7, Phase 2 item 6). Real OAuth + posting to the
// member's *personal* profile.
//
// ⚠️ VERIFY against current LinkedIn docs — endpoints/scopes/version change
// often. As implemented here:
//   - Auth:   OpenID Connect authorize + token endpoints
//   - Scopes: `openid profile email` (sign-in) + `w_member_social` (posting)
//   - Author: member URN from the OIDC /userinfo `sub`
//   - Publish: POST /rest/posts with a `LinkedIn-Version` header (supersedes
//     the legacy /v2/ugcPosts). Text-only for MVP.
// `w_member_social` covers ONLY the user's own profile — company pages need the
// gated `w_organization_social`, out of scope for MVP.

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const POSTS_URL = "https://api.linkedin.com/rest/posts";

const SCOPES = ["openid", "profile", "email", "w_member_social"];

// LinkedIn versions its REST API by month (YYYYMM) and only accepts versions
// within a rolling ~12-month window — an out-of-window value returns 426. Keep
// this configurable and set LINKEDIN_API_VERSION to a currently-supported month
// (see the LinkedIn Developer Portal); the default is only a recent fallback.
const API_VERSION = process.env.LINKEDIN_API_VERSION ?? "202606";

function clientId(): string {
  const v = process.env.LINKEDIN_CLIENT_ID;
  if (!v) throw new Error("LINKEDIN_CLIENT_ID is not set");
  return v;
}

function clientSecret(): string {
  const v = process.env.LINKEDIN_CLIENT_SECRET;
  if (!v) throw new Error("LINKEDIN_CLIENT_SECRET is not set");
  return v;
}

function redirectUri(): string {
  const v = process.env.LINKEDIN_REDIRECT_URI;
  if (!v) throw new Error("LINKEDIN_REDIRECT_URI is not set");
  return v;
}

interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

function toOAuthToken(data: TokenResponse): OAuthToken {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scopes: data.scope ? data.scope.split(/[\s,]+/).filter(Boolean) : SCOPES,
  };
}

async function exchange(params: Record<string, string>): Promise<OAuthToken> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  if (!res.ok) {
    // Never surface the response body raw — it can echo the client secret.
    throw new Error(`LinkedIn token exchange failed (${res.status})`);
  }
  return toOAuthToken((await res.json()) as TokenResponse);
}

/** Resolve the posting author URN from the access token's OIDC identity. */
async function memberUrn(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`LinkedIn userinfo failed (${res.status})`);
  }
  const { sub } = (await res.json()) as { sub?: string };
  if (!sub) throw new Error("LinkedIn userinfo returned no member id");
  return `urn:li:person:${sub}`;
}

export const linkedinAdapter: PlatformAdapter = {
  platform: "linkedin" satisfies PlatformId,

  getAuthUrl(_userId: string, state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId(),
      redirect_uri: redirectUri(),
      scope: SCOPES.join(" "),
      state,
    });
    return `${AUTHORIZE_URL}?${params}`;
  },

  handleOAuthCallback(code: string): Promise<OAuthToken> {
    return exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: clientId(),
      client_secret: clientSecret(),
    });
  },

  refreshToken(token: OAuthToken): Promise<OAuthToken> {
    if (!token.refreshToken) {
      throw new AdapterNotSupportedError("linkedin", "refreshToken (no refresh_token)");
    }
    return exchange({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
    });
  },

  async publish({ content, token }: PublishInput): Promise<PostResult> {
    if (!token) {
      // No connection — the orchestrator (review action) falls back to the
      // copy-to-clipboard client action instead of calling this.
      throw new AdapterNotSupportedError("linkedin", "publish (not connected)");
    }

    const author = await memberUrn(token.accessToken);
    const res = await fetch(POSTS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
        "linkedin-version": API_VERSION,
        "x-restli-protocol-version": "2.0.0",
      },
      cache: "no-store",
      body: JSON.stringify({
        author,
        commentary: content,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });

    if (!res.ok) {
      // The publish response body carries no secrets (the token is in the
      // request), so surface LinkedIn's message — a 426 lists the versions it
      // accepts, which is exactly what LINKEDIN_API_VERSION needs to match.
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      const hint =
        res.status === 426
          ? ` — the LinkedIn-Version header (${API_VERSION}) is out of the supported window; set LINKEDIN_API_VERSION to a current version.`
          : "";
      throw new Error(
        `LinkedIn publish failed (${res.status})${hint}${detail ? ` ${detail}` : ""}`,
      );
    }

    // The created post's URN comes back in a header, not the (empty) body.
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    return {
      status: "published",
      externalPostId: urn ?? undefined,
      externalPostUrl: urn
        ? `https://www.linkedin.com/feed/update/${urn}`
        : undefined,
    };
  },
};
