"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateIdeaSeed, finalizeAndGenerate } from "@/app/actions/ideas";
import { PLATFORM_LABELS } from "@/lib/platforms";

// Idea finalization (doc Section 5.2): iterate on the raw seed, then lock it in
// and fan out generation to both platforms. Generation runs in-request (Server
// Action + Promise.all), so we hold a clear pending state while it drafts.
export function IdeaComposer({
  ideaId,
  initialSeed,
}: {
  ideaId: string;
  initialSeed: string;
}) {
  const [seed, setSeed] = useState(initialSeed);
  const [pending, startTransition] = useTransition();

  function handleGenerate() {
    startTransition(async () => {
      const trimmed = seed.trim();
      if (trimmed && trimmed !== initialSeed) {
        await updateIdeaSeed(ideaId, trimmed);
      }
      // Redirects back to this idea once the versioned draft is persisted.
      await finalizeAndGenerate(ideaId);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Sparkles className="size-4 text-accent" />
        <span className="text-xs font-medium uppercase tracking-widest">
          Refine the idea
        </span>
      </div>
      <Textarea
        value={seed}
        onChange={(e) => setSeed(e.target.value)}
        rows={6}
        disabled={pending}
        className="min-h-40 text-base leading-relaxed"
        placeholder="Sharpen the angle, tone, or key point before drafting…"
      />
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Locks the idea and drafts one post each for{" "}
          {PLATFORM_LABELS.linkedin} and {PLATFORM_LABELS.x}, then critiques
          them.
        </p>
        <Button disabled={pending || !seed.trim()} onClick={handleGenerate}>
          {pending ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {pending ? "Drafting…" : "Finalize & generate"}
        </Button>
      </div>
      {pending && (
        <p className="rounded-lg border border-border bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Drafting for {PLATFORM_LABELS.linkedin} and {PLATFORM_LABELS.x} in
          parallel, then running the critique / rewrite pass. This takes a few
          moments.
        </p>
      )}
    </div>
  );
}
