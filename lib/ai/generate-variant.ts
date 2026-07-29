import { generatePlatformVariant, type GeneratedVariant } from "@/lib/ai/generate";
import { generatePlatformVariantV2 } from "@/lib/ai/agents/pipeline";
import type { PlatformId } from "@/lib/platforms";
import type { PersonaProfile } from "@/lib/persona-shared";

// Single entry point the actions call. Dispatches between the v1 loop
// (plan→draft→critique→rewrite) and the v2 multi-agent pipeline
// (research→debate→critic→fact-check) via the REN_PIPELINE_V2 flag, so the two
// paths stay side-by-side and v2 can be rolled out / compared safely.

export type GenerateCtx = {
  userId: string;
  sourceUrl?: string | null;
  feedback?: {
    retryReason?: string;
    customInstruction?: string;
    critiqueNotes?: string;
    priorPattern?: string;
  };
};

export function isV2Pipeline(): boolean {
  return ["1", "true", "on"].includes(process.env.REN_PIPELINE_V2 ?? "");
}

export async function generateVariant(
  seedText: string,
  platform: PlatformId,
  profile: PersonaProfile,
  ctx: GenerateCtx,
): Promise<GeneratedVariant> {
  if (isV2Pipeline()) {
    return generatePlatformVariantV2(seedText, platform, profile, ctx);
  }
  return generatePlatformVariant(seedText, platform, profile, ctx.feedback);
}
