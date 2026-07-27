"use server";

import { requireUser } from "@/lib/auth";
import { getHeadlines } from "@/lib/news";
import {
  NEWS_CATEGORIES,
  type Headline,
  type NewsCategory,
} from "@/lib/news-shared";

// Server action backing the news-seeded brainstorm (doc Section 5.1). The home
// screen calls this to load a category's headline feed on demand.
export async function loadHeadlines(
  category: NewsCategory,
): Promise<Headline[]> {
  await requireUser(); // gate behind app auth like every other action
  if (!NEWS_CATEGORIES.includes(category)) {
    throw new Error("Unknown category");
  }
  return getHeadlines(category);
}
