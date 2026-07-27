import type { PlatformId } from "@/lib/platforms";
import type { PlatformAdapter } from "@/lib/adapters/types";
import { xAdapter } from "@/lib/adapters/x";
import { linkedinAdapter } from "@/lib/adapters/linkedin";

const ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  x: xAdapter,
  linkedin: linkedinAdapter,
};

/** Resolve the adapter for a platform. Orchestrator/UI depend only on this. */
export function getAdapter(platform: PlatformId): PlatformAdapter {
  return ADAPTERS[platform];
}

export type { PlatformAdapter, PostResult, OAuthToken } from "@/lib/adapters/types";
