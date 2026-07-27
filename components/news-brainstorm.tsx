"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowUpRight, Loader2, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";
import { createIdea } from "@/app/actions/ideas";
import { loadHeadlines } from "@/app/actions/news";
import {
  NEWS_CATEGORIES,
  NEWS_CATEGORY_LABELS,
  type Headline,
  type NewsCategory,
} from "@/lib/news-shared";

// News-seeded brainstorm (doc Section 5.1): pick a category, browse recent RSS
// headlines, click one to seed an idea. Each headline is a <form> posting to
// createIdea (source becomes 'news' when seedNewsUrl is present) so selection
// redirects straight into the idea flow — no bespoke client submit needed.
export function NewsBrainstorm() {
  const [category, setCategory] = useState<NewsCategory>(NEWS_CATEGORIES[0]);
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    startTransition(async () => {
      try {
        const items = await loadHeadlines(category);
        if (active) {
          setHeadlines(items);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    });
    return () => {
      active = false;
    };
  }, [category]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-muted-foreground">
        <Newspaper className="size-4 text-accent" />
        <span className="text-xs font-medium uppercase tracking-widest">
          Or start from the news
        </span>
      </div>

      {/* Category filter */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {NEWS_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              c === category
                ? "border-accent bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-foreground"
                : "border-border text-muted-foreground hover:border-[color-mix(in_oklch,var(--accent)_45%,var(--border))] hover:text-foreground",
            )}
          >
            {NEWS_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Headline feed */}
      {pending ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-5 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Pulling{" "}
          {NEWS_CATEGORY_LABELS[category]} headlines…
        </div>
      ) : error ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
          Couldn&apos;t load headlines right now. Try another category.
        </p>
      ) : headlines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
          No headlines found for {NEWS_CATEGORY_LABELS[category]}.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {headlines.map((h) => (
            <li key={h.sourceUrl}>
              <HeadlineRow headline={h} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HeadlineRow({ headline }: { headline: Headline }) {
  // Seed text leads with the headline; the summary gives the agent context.
  const seedText = headline.summary
    ? `${headline.headline}\n\n${headline.summary}`
    : headline.headline;

  return (
    <form action={createIdea}>
      <input type="hidden" name="seedText" value={seedText} />
      <input type="hidden" name="seedNewsUrl" value={headline.sourceUrl} />
      <button
        type="submit"
        className="group flex w-full items-start gap-3 rounded-xl border border-border bg-card px-5 py-4 text-left transition-colors hover:border-[color-mix(in_oklch,var(--accent)_45%,var(--border))]"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-card-foreground">
            {headline.headline}
          </p>
          {headline.summary && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {headline.summary}
            </p>
          )}
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
      </button>
    </form>
  );
}
