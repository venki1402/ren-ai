import "server-only";
import { db } from "@/lib/db";
import type { Headline, NewsCategory } from "@/lib/news-shared";

// News ingestion (doc Section 5.1 / Phase 2 item 8). RSS feeds by category are
// the primary source — no paid news API needed for MVP. Parsed with a small
// dependency-free reader (handles RSS 2.0 <item> and Atom <entry>), then cached
// in the `news_cache` table so the brainstorm screen isn't hitting outlets on
// every keystroke. Client-safe constants/types live in lib/news-shared.ts.

export type { Headline, NewsCategory } from "@/lib/news-shared";

// A couple of reliable feeds per category. BBC exposes clean per-topic RSS 2.0;
// The Verge / Ars Technica cover tech well. Kept small on purpose.
const CATEGORY_FEEDS: Record<NewsCategory, string[]> = {
  tech: [
    "https://www.theverge.com/rss/index.xml",
    "https://feeds.arstechnica.com/arstechnica/index",
  ],
  business: ["https://feeds.bbci.co.uk/news/business/rss.xml"],
  science: ["https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"],
  world: ["https://feeds.bbci.co.uk/news/world/rss.xml"],
  entertainment: [
    "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
  ],
};

// How long a category's cache stays fresh before we refetch its feeds.
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_HEADLINES = 12;

// ─── Minimal RSS/Atom parsing (no dependency) ─────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "") // strip any nested HTML (common in descriptions)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi");
  return xml.match(re) ?? [];
}

function firstTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

// Atom links carry the URL in an href attribute rather than as text.
function atomLink(block: string): string | null {
  const alt = block.match(
    /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i,
  );
  if (alt) return alt[1];
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any ? any[1] : null;
}

function parseFeed(xml: string): Headline[] {
  const items = blocks(xml, "item");
  const entries = items.length > 0 ? items : blocks(xml, "entry");
  const out: Headline[] = [];

  for (const block of entries) {
    const headline = firstTag(block, "title");
    const link = firstTag(block, "link") || atomLink(block);
    if (!headline || !link) continue;
    const summary =
      firstTag(block, "description") ||
      firstTag(block, "summary") ||
      firstTag(block, "content");
    out.push({
      headline,
      sourceUrl: link,
      summary: summary ? truncate(summary, 240) : null,
    });
  }
  return out;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

async function fetchFeed(url: string): Promise<Headline[]> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Ren/1.0 (+news ingestion)" },
      // Let Next cache the raw HTTP response; our DB cache is the source of truth.
      next: { revalidate: 900 },
    });
    if (!res.ok) return [];
    return parseFeed(await res.text());
  } catch {
    return []; // a flaky outlet must never break the brainstorm screen
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Recent headlines for a category. Serves the DB cache when fresh; otherwise
 * refetches the category's feeds, replaces its cached rows, and returns those.
 * Falls back to stale cache if every feed fails.
 */
export async function getHeadlines(category: NewsCategory): Promise<Headline[]> {
  const cached = await db.newsCache.findMany({
    where: { category },
    orderBy: { fetchedAt: "desc" },
    take: MAX_HEADLINES,
  });

  const newest = cached[0]?.fetchedAt;
  const fresh = newest && Date.now() - newest.getTime() < CACHE_TTL_MS;
  if (fresh) return cached.map(toHeadline);

  const results = await Promise.all(
    (CATEGORY_FEEDS[category] ?? []).map(fetchFeed),
  );
  const headlines = dedupe(results.flat()).slice(0, MAX_HEADLINES);

  // Every feed failed — keep serving whatever we last had rather than nothing.
  if (headlines.length === 0) return cached.map(toHeadline);

  // Replace this category's cache atomically-ish (delete then insert).
  await db.$transaction([
    db.newsCache.deleteMany({ where: { category } }),
    db.newsCache.createMany({
      data: headlines.map((h) => ({
        category,
        headline: h.headline,
        sourceUrl: h.sourceUrl,
        summary: h.summary,
      })),
    }),
  ]);

  return headlines;
}

function dedupe(items: Headline[]): Headline[] {
  const seen = new Set<string>();
  return items.filter((h) => {
    if (seen.has(h.sourceUrl)) return false;
    seen.add(h.sourceUrl);
    return true;
  });
}

function toHeadline(row: {
  headline: string;
  sourceUrl: string;
  summary: string | null;
}): Headline {
  return {
    headline: row.headline,
    sourceUrl: row.sourceUrl,
    summary: row.summary,
  };
}
