import { withSpan } from "@/lib/ai/observability/trace";
import { sanitizeRetrieved } from "@/lib/ai/safety";

// Live web search via Tavily — the Researcher's tool for grounding posts in
// current, real facts (news, stats, events) that aren't in the local grounding
// index. Best-effort: returns [] with no key or on any error, so the pipeline
// degrades to voice/persona-only grounding instead of breaking.

export interface WebResult {
  title: string;
  url: string;
  content: string; // Tavily's extracted snippet
  score: number;
}

export function tavilyEnabled(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

export async function tavilySearch(
  query: string,
  opts: { maxResults?: number } = {},
): Promise<WebResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  const maxResults = opts.maxResults ?? 5;

  return withSpan(
    { name: "tool:web-search", kind: "tool", input: { query, maxResults } },
    async () => {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            query,
            max_results: maxResults,
            search_depth: "basic",
            topic: "general",
            include_answer: false,
          }),
        });
        if (!res.ok) {
          console.warn(`[tavily] search failed: HTTP ${res.status}`);
          return [];
        }
        const data = (await res.json()) as {
          results?: { title?: string; url?: string; content?: string; score?: number }[];
        };
        return (data.results ?? [])
          .filter((r) => r.url && r.content)
          .map((r) => ({
            title: r.title ?? r.url!,
            url: r.url!,
            content: sanitizeRetrieved(r.content!), // untrusted web text
            score: r.score ?? 0,
          }));
      } catch (err) {
        console.warn("[tavily] search error:", (err as Error).message);
        return [];
      }
    },
  );
}
