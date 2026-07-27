import type { PlatformId } from "@/lib/platforms";

// Platform adapter contract (doc Section 7). This interface MUST stay stable:
// Phase 1's Web-Intents/clipboard adapters and Phase 2's real LinkedIn API
// adapter implement the exact same shape so the orchestrator/UI never change.

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

export interface PublishInput {
  content: string;
  token?: OAuthToken; // absent for tokenless MVP adapters (X intents / clipboard)
}

// A publish either completes server-side (real API) or hands a small action
// back to the client (open a URL / copy text). One shape covers both so the UI
// handles every platform uniformly and future API adapters swap in cleanly.
export type PostResult =
  | {
      status: "published";
      externalPostId?: string;
      externalPostUrl?: string;
    }
  | {
      status: "client_action";
      action: "open_url" | "copy";
      url?: string;
      text?: string;
    };

export interface PlatformAdapter {
  readonly platform: PlatformId;
  // `state` is the CSRF token minted by the OAuth start route and echoed back
  // on the callback (verified against an httpOnly cookie).
  getAuthUrl(userId: string, state: string): string;
  handleOAuthCallback(code: string): Promise<OAuthToken>;
  refreshToken(token: OAuthToken): Promise<OAuthToken>;
  publish(input: PublishInput): Promise<PostResult>;
}

export class AdapterNotSupportedError extends Error {
  constructor(platform: string, method: string) {
    super(`${method} is not supported by the ${platform} adapter (MVP).`);
    this.name = "AdapterNotSupportedError";
  }
}
