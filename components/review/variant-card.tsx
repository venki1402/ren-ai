"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  Sliders,
  Trash2,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScoreBars } from "@/components/review/score-bars";
import { cn } from "@/lib/utils";
import { overallScore, toneFor, TONE_VAR, type RubricScore } from "@/lib/score";
import { PLATFORM_LABELS, X_MAX_CHARS, type PlatformId } from "@/lib/platforms";
import {
  retryVariant,
  editVariant,
  discardVariant,
  getPublishAction,
  confirmPosted,
} from "@/app/actions/review";

export type Citation = {
  sourceUrl: string;
  title: string | null;
  snippet: string;
};

export type VariantView = {
  id: string;
  platform: PlatformId;
  content: string;
  hookAlternatives: string[];
  score: RubricScore | null;
  critiqueNotes: string | null;
  citations: Citation[];
  posted: boolean;
  discarded: boolean;
};

type RetryReason = "too_salesy" | "weak_hook" | "not_authentic" | "other";

const RETRY_CHIPS: { value: RetryReason; label: string }[] = [
  { value: "too_salesy", label: "Too salesy" },
  { value: "weak_hook", label: "Weak hook" },
  { value: "not_authentic", label: "Not authentic" },
  { value: "other", label: "Other" },
];

// Collapse multiple chunks from the same article into one listed source.
function dedupeCitations(items: Citation[]): Citation[] {
  const seen = new Set<string>();
  return items.filter((c) => {
    if (seen.has(c.sourceUrl)) return false;
    seen.add(c.sourceUrl);
    return true;
  });
}

// Replace the first non-empty line of the content with a chosen alternative
// hook. Persisted as a new version via editVariant (never an overwrite).
function swapHook(content: string, hook: string): string {
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.trim().length > 0);
  if (idx === -1) return hook;
  lines[idx] = hook;
  return lines.join("\n");
}

export function VariantCard({
  variant,
  linkedinConnected = false,
}: {
  variant: VariantView;
  linkedinConnected?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(variant.content);
  const [showDetails, setShowDetails] = useState(false);
  const [showRetry, setShowRetry] = useState(false);
  const [retryNote, setRetryNote] = useState("");
  const [showHooks, setShowHooks] = useState(false);
  // After a publish hand-off there's no callback, so we ask the user to confirm.
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  const label = PLATFORM_LABELS[variant.platform];
  const isX = variant.platform === "x";
  // LinkedIn posts server-side (real API) only once the account is connected;
  // otherwise it falls back to copy-to-clipboard.
  const isLinkedInApi = variant.platform === "linkedin" && linkedinConnected;
  const overall = variant.score ? overallScore(variant.score) : null;
  const overTweetLimit = isX && variant.content.length > X_MAX_CHARS;

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      await fn();
    });
  }

  async function handlePublish() {
    const result = await getPublishAction(variant.id);
    if (result.status === "published") {
      // Server already posted + logged it; refresh to show the Posted state.
      startTransition(() => router.refresh());
      return;
    }
    if (result.action === "open_url" && result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    } else if (result.action === "copy" && result.text) {
      await navigator.clipboard.writeText(result.text);
    }
    // No callback confirms a Web Intent / clipboard post — ask the user.
    setAwaitingConfirm(true);
  }

  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card",
        variant.discarded && "opacity-55",
      )}
    >
      {/* Header: platform + score */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">{label}</span>
          {variant.posted && (
            <Badge variant="accent">
              <Check className="size-3" /> Posted
            </Badge>
          )}
          {variant.discarded && !variant.posted && (
            <Badge variant="outline">Discarded</Badge>
          )}
        </div>
        {overall !== null && (
          <button
            type="button"
            onClick={() => setShowDetails((s) => !s)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            title="Show rubric breakdown"
          >
            <span
              className="tabular-nums font-medium"
              style={{ color: TONE_VAR[toneFor(overall)] }}
            >
              {overall.toFixed(1)}
            </span>
            <span>/ 10</span>
            <Sliders className="size-3.5" />
          </button>
        )}
      </header>

      {/* Score breakdown + critique (collapsible, not forced — doc 5.5) */}
      {showDetails && variant.score && (
        <div className="flex flex-col gap-3 border-b border-border bg-[color-mix(in_oklch,var(--muted)_40%,transparent)] px-5 py-4">
          <ScoreBars score={variant.score} />
          {variant.critiqueNotes && (
            <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Critique. </span>
              {variant.critiqueNotes}
            </p>
          )}
        </div>
      )}

      {/* Draft content — the visual hero (doc Section 8) */}
      <div className="flex-1 px-5 py-5">
        {editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            className="min-h-64 text-[15px] leading-relaxed"
            autoFocus
          />
        ) : (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-card-foreground">
            {variant.content}
          </p>
        )}

        {isX && (
          <p
            className={cn(
              "mt-3 text-right text-xs tabular-nums",
              overTweetLimit ? "text-[var(--bad)]" : "text-muted-foreground",
            )}
          >
            {(editing ? draft : variant.content).length} / {X_MAX_CHARS}
          </p>
        )}

        {/* Hook alternatives — swap the winning hook (doc Section 4/5.3) */}
        {!editing && variant.hookAlternatives.length > 1 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowHooks((s) => !s)}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {showHooks ? "Hide" : "Swap"} hook (
              {variant.hookAlternatives.length} options)
            </button>
            {showHooks && (
              <ul className="mt-2 flex flex-col gap-1.5">
                {variant.hookAlternatives.map((hook, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          editVariant(
                            variant.id,
                            swapHook(variant.content, hook),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:border-[color-mix(in_oklch,var(--accent)_45%,var(--border))] hover:text-foreground disabled:opacity-50"
                    >
                      {hook}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Grounding citations (v2 pipeline) — the sources the post was
            grounded + fact-checked against. */}
        {!editing && variant.citations.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Grounded on {variant.citations.length} source
              {variant.citations.length > 1 ? "s" : ""}
            </p>
            <ul className="flex flex-col gap-1">
              {dedupeCitations(variant.citations).map((c, i) => (
                <li key={i} className="truncate text-xs">
                  <a
                    href={c.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                    title={c.snippet}
                  >
                    {c.title ?? c.sourceUrl}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Retry reason chips + freeform instruction (doc 5.5) */}
      {showRetry && (
        <div className="flex flex-col gap-3 border-t border-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Why regenerate?</span>
            {RETRY_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    await retryVariant(variant.id, chip.value);
                    setShowRetry(false);
                    setRetryNote("");
                  })
                }
                className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-[color-mix(in_oklch,var(--accent)_45%,var(--border))] hover:text-foreground disabled:opacity-50"
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Textarea
              value={retryNote}
              onChange={(e) => setRetryNote(e.target.value)}
              rows={2}
              disabled={pending}
              placeholder="Or tell Ren exactly what to change — e.g. “lead with the Go migration story, cut the stats”"
              className="min-h-16 text-xs leading-relaxed"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !retryNote.trim()}
              className="self-end"
              onClick={() =>
                run(async () => {
                  await retryVariant(variant.id, "other", retryNote.trim());
                  setShowRetry(false);
                  setRetryNote("");
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Regenerate with these notes
            </Button>
          </div>
        </div>
      )}

      {/* Post-confirmation toggle (no callback from Web Intents — doc 5.6) */}
      {awaitingConfirm && !variant.posted && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {isX ? "Opened X to post." : "Copied to clipboard."} Did it post?
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setAwaitingConfirm(false)}
            >
              Not yet
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await confirmPosted(variant.id);
                  setAwaitingConfirm(false);
                })
              }
            >
              <Check /> Yes, posted
            </Button>
          </div>
        </div>
      )}

      {/* Action bar */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        {editing ? (
          <>
            <Button
              size="sm"
              disabled={pending || !draft.trim()}
              onClick={() =>
                run(async () => {
                  await editVariant(variant.id, draft);
                  setEditing(false);
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Save version
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setDraft(variant.content);
                setEditing(false);
              }}
            >
              <XIcon /> Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={pending} onClick={handlePublish}>
              {/* External-link icon only when the action leaves the app (X Web
                  Intent). A connected LinkedIn posts server-side, so no icon;
                  the not-connected fallback copies, so a copy icon. */}
              {isX ? <ExternalLink /> : isLinkedInApi ? null : <Copy />}
              {isX
                ? "Post on X"
                : isLinkedInApi
                  ? "Post on LinkedIn"
                  : "Copy for LinkedIn"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setShowRetry((s) => !s)}
            >
              <RefreshCw /> Retry
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(true)}
            >
              <Pencil /> Edit
            </Button>
            {variant.platform === "linkedin" && !linkedinConnected && (
              <a
                href="/settings"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Connect to post directly
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || variant.discarded}
              className="ml-auto"
              onClick={() => run(() => discardVariant(variant.id))}
            >
              <Trash2 /> Discard
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
