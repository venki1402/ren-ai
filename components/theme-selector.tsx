"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ACCENT_COOKIE,
  ACCENT_IDS,
  ACCENTS,
  type AccentId,
} from "@/lib/theme";

// Applies the choice instantly by flipping data-accent on <html> and persists
// it in a cookie for the next load. Kept at module scope (not in the component
// body) so these DOM side-effects sit outside React's render analysis.
function applyAccent(id: AccentId) {
  document.documentElement.setAttribute("data-accent", id);
  document.cookie = `${ACCENT_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
}

// Accent picker. Updates live so every accent-colored element reflects the
// choice, and the root layout restores it on the next load without a flash.
export function ThemeSelector({ current }: { current: AccentId }) {
  const [accent, setAccent] = useState<AccentId>(current);

  function choose(id: AccentId) {
    setAccent(id);
    applyAccent(id);
  }

  return (
    <div className="flex flex-wrap gap-3">
      {ACCENT_IDS.map((id) => {
        const selected = id === accent;
        return (
          <button
            key={id}
            type="button"
            onClick={() => choose(id)}
            aria-pressed={selected}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
              selected
                ? "border-accent bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-foreground"
                : "border-border text-muted-foreground hover:border-[color-mix(in_oklch,var(--accent)_45%,var(--border))] hover:text-foreground",
            )}
          >
            <span
              className="grid size-5 place-items-center rounded-full"
              style={{ background: ACCENTS[id].swatch }}
            >
              {selected && (
                <Check className="size-3 text-[var(--accent-foreground)]" />
              )}
            </span>
            {ACCENTS[id].label}
          </button>
        );
      })}
    </div>
  );
}
