// Shared platform constants (safe to import in client components — no server deps).

export type PlatformId = "linkedin" | "x";

export const PLATFORMS: PlatformId[] = ["linkedin", "x"];

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  linkedin: "LinkedIn",
  x: "X",
};

// X MVP is single-post via Web Intents — keep drafts within a safe tweet length.
export const X_MAX_CHARS = 280;
