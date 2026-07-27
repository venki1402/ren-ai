import type { PlatformId } from "@/lib/platforms";
import {
  AdapterNotSupportedError,
  type OAuthToken,
  type PlatformAdapter,
  type PostResult,
  type PublishInput,
} from "@/lib/adapters/types";

// X adapter (MVP): a URL builder, not an API client. No OAuth — the auth
// methods are intentional no-ops (they throw) so the interface stays whole.
// A future XApiAdapter (real paid API + threads) swaps in with the same shape.
export const xAdapter: PlatformAdapter = {
  platform: "x" satisfies PlatformId,

  getAuthUrl(): string {
    throw new AdapterNotSupportedError("x", "getAuthUrl");
  },

  handleOAuthCallback(): Promise<OAuthToken> {
    throw new AdapterNotSupportedError("x", "handleOAuthCallback");
  },

  refreshToken(): Promise<OAuthToken> {
    throw new AdapterNotSupportedError("x", "refreshToken");
  },

  async publish({ content }: PublishInput): Promise<PostResult> {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(content)}`;
    // The client opens this; there's no callback confirming success, so the UI
    // logs the post optimistically and shows a "Did this post?" confirm toggle.
    return { status: "client_action", action: "open_url", url };
  },
};
