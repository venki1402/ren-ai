import { db } from "@/lib/db";
import type { RetryReason } from "@prisma/client";

// Closes the feedback loop: PostEvent retry data (previously write-only) is
// aggregated per user and fed back into generation, so recurring rejections
// proactively steer future drafts. This is the "learn from the user's own
// style" loop the design doc set the data up for.

const REASON_PHRASE: Record<RetryReason, string> = {
  too_salesy: "too salesy",
  weak_hook: "weak hook",
  not_authentic: "inauthentic / AI-tells",
  other: "other",
};

export interface RetrySignals {
  topReasons: { reason: RetryReason; phrase: string; count: number }[];
  recentInstructions: string[];
}

/** Aggregate a user's retry history across all their ideas. */
export async function getRetrySignals(userId: string): Promise<RetrySignals> {
  const ownedByUser = {
    action: "retry" as const,
    platformVariant: { draft: { idea: { userId } } },
  };

  const [grouped, instructions] = await Promise.all([
    db.postEvent.groupBy({
      by: ["retryReason"],
      where: ownedByUser,
      _count: { _all: true },
    }),
    db.postEvent.findMany({
      where: { ...ownedByUser, retryInstruction: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { retryInstruction: true },
    }),
  ]);

  const topReasons = grouped
    .filter((g): g is typeof g & { retryReason: RetryReason } => g.retryReason !== null)
    .map((g) => ({
      reason: g.retryReason,
      phrase: REASON_PHRASE[g.retryReason],
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    topReasons,
    recentInstructions: instructions
      .map((i) => i.retryInstruction!)
      .filter(Boolean),
  };
}

// A retry reason has to recur before we act on it — one-off rejections are
// noise, a repeated pattern is signal.
const RECURRENCE_THRESHOLD = 2;

/** Turn aggregated signals into a generation-prompt note, or null if too thin. */
export function buildFeedbackNote(signals: RetrySignals): string | null {
  const recurring = signals.topReasons.filter((r) => r.count >= RECURRENCE_THRESHOLD);
  if (recurring.length === 0 && signals.recentInstructions.length === 0) return null;

  const parts: string[] = [];
  if (recurring.length) {
    const list = recurring.map((r) => `"${r.phrase}" (${r.count}×)`).join(", ");
    parts.push(
      `This creator has repeatedly rejected past drafts for: ${list}. Proactively avoid these failure modes from the start.`,
    );
  }
  if (signals.recentInstructions.length) {
    parts.push(
      `Recent explicit change requests they've made:\n${signals.recentInstructions
        .map((i) => `- ${i}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

/** Fetch + summarize in one call for the generation path. */
export async function getFeedbackNote(userId: string): Promise<string | null> {
  return buildFeedbackNote(await getRetrySignals(userId));
}
