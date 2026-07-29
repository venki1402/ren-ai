import type { PlatformId } from "@/lib/platforms";

// Shared types for the multi-agent pipeline (v2). Kept separate so the
// orchestrator, agents, and prompt builders agree on shapes.

export interface Citation {
  sourceUrl: string;
  title: string | null;
  snippet: string;
}

export interface VoiceExemplar {
  platform: PlatformId;
  content: string;
  similarity: number;
}

// What the Researcher agent hands to the Drafters: a synthesized brief plus the
// concrete evidence it pulled (captured deterministically from tool runs).
export interface ResearchBrief {
  brief: string;
  voiceExemplars: VoiceExemplar[];
  citations: Citation[];
}
