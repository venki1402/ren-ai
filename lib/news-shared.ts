// Client-safe news constants & types (no server deps — safe to import in client
// components). The RSS fetching + DB caching lives in lib/news.ts (server-only).

export const NEWS_CATEGORIES = [
  "tech",
  "business",
  "science",
  "world",
  "entertainment",
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  tech: "Tech",
  business: "Business",
  science: "Science",
  world: "World",
  entertainment: "Entertainment",
};

export interface Headline {
  headline: string;
  sourceUrl: string;
  summary: string | null;
}
