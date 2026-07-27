# Ren — Project Specification

> **Ren (連)** — "link, chain, connect." One idea, tuned and carried across every platform it needs to reach.

A creator-infrastructure platform: research a topic, brainstorm an idea, let an AI agent draft platform-tuned posts for LinkedIn and X, review/improve them through a critique loop, and publish with a human always in the loop.

This document is the implementation brief for Claude Code. It covers architecture, data model, agent pipeline, platform adapters, design direction, and a phased build order. Sections are written to be actioned roughly top to bottom.

---

## 1. Product Vision

Ren is not a scheduler bolted onto an LLM. Its core bet is that **content tuned per-platform, refined through a review loop, and always confirmed by a human before publishing** produces better, more authentic posts than generic multi-post blasting tools (Buffer, Hootsuite) or single-shot AI writers.

**MVP scope (build this first):**
- Single user, personal accounts only (no teams, no company pages)
- Platforms: LinkedIn (personal profile) + X
- Flow: Brainstorm → News-seeded ideation → Agent draft fan-out → Review/rewrite loop → HITL approval → Publish

**Explicitly out of scope for MVP:** company page posting, Instagram/TikTok/other platforms, team collaboration, analytics-driven auto-tuning (needs historical data first), scheduling calendar UI (can follow after core loop works).

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend + Backend | Next.js (App Router) | Single deployment, on Vercel. API routes / Server Actions serve as the backend — no separate service |
| Database | PostgreSQL via **Neon** | Standard connection string works fine on Vercel's Node.js runtime — no HTTP/edge driver adapter needed |
| ORM | Prisma | Works cleanly here specifically *because* we're not deploying to Cloudflare Workers — Prisma's standard client needs a Node runtime, which Vercel provides by default |
| Auth (app users) | Clerk | Handles sign-up/login/session for Ren itself. Does **not** cover LinkedIn/X connections — those are separate OAuth flows the app owns directly (see Section 7) |
| Background jobs / scheduling | Inngest | **Phase 3 only.** Event-driven functions callable from Next.js for *scheduled/timed publishing* (cron + delayed triggers). Not used for draft generation — the 2-platform fan-out is a plain Server Action with `Promise.all` (Section 5.3), which also lets drafts stream straight back to the client. Generous free tier, first-party Next.js support |
| AI | Groq API | **`openai/gpt-oss-120b`** as the primary model for drafting and critique (best available free-tier quality, 200K TPD ceiling). **`llama-3.3-70b-versatile`** as a secondary model for lighter rewrite passes — since Groq's free-tier rate limits are tracked per model, routing across both effectively gives two separate quota pools instead of one |
| Auth (platform posting) | OAuth 2.0, per-platform | LinkedIn OpenID Connect + Share on LinkedIn; X Web Intents for MVP (no OAuth needed yet) |
| News ingestion | RSS feeds (category outlets) as primary source; GNews/NewsData.io free tier as optional structured fallback | No paid news API needed for MVP |

**Why not Cloudflare Workers:** Workers' main advantages — global edge latency and cheap always-on scheduling via Durable Objects/Queues — don't apply to a personal-scale creator tool. Workers' restricted runtime (no raw TCP, partial Node API support) also actively fights against Prisma and Clerk, both of which are built primarily for Node environments. Running everything in Next.js on Vercel means one runtime, first-party support for both Prisma and Clerk with zero adapter workarounds, and Inngest covers the Phase 3 scheduling need that Durable Objects would otherwise have handled (the draft fan-out is just a Server Action — see Section 5.3).

---

## 3. Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│  Next.js (App Router) — deployed on Vercel                   │
│  ┌────────────┐ ┌──────────────────┐ ┌───────────────────┐  │
│  │ Clerk auth  │ │ Draft Server      │ │ Platform Adapters  │  │
│  │ (app login) │ │ Action            │ │ (LinkedIn / X)     │  │
│  │             │ │ fan-out via       │ │                    │  │
│  │             │ │ Promise.all,      │ │                    │  │
│  │             │ │ streams to client │ │                    │  │
│  └────────────┘ └────────┬─────────┘ └─────────┬───────────┘  │
│                           │  Groq (gen/critique)│              │
│                           │                     │              │
│  ┌──────────────────────────────────────────┐  │              │
│  │ Inngest functions — Phase 3 ONLY          │  │              │
│  │ (scheduled / timed publishing)            │──┘              │
│  └──────────────────────────────────────────┘                 │
└───────────────────────────┼──────────────────────────────────┘
                             │
                   ┌─────────▼─────────┐
                   │ Postgres (Neon,   │
                   │ via Prisma)       │
                   │ ideas / drafts /  │
                   │ platform_variants │
                   │ oauth_tokens etc. │
                   └───────────────────┘
```

---

## 4. Database Schema (Prisma / Postgres)

```
users
  id, clerk_user_id (unique, from Clerk), email, name, avatar_url, created_at

oauth_connections
  id, user_id (fk), platform ('linkedin' | 'x'),
  access_token (encrypted), refresh_token (encrypted),
  expires_at, scopes, created_at, updated_at
  -- encryption: app-level AES-256-GCM via Node `crypto`, key from env
  --   (OAUTH_ENC_KEY). Encrypt/decrypt in the adapter layer, never log
  --   raw tokens. Postgres `pgcrypto` is an acceptable alternative.

ideas
  id, user_id (fk), source ('manual' | 'news'),
  seed_text, seed_news_url (nullable),
  status ('draft' | 'finalized' | 'archived'),
  created_at

drafts
  id, idea_id (fk), version (int),
  status ('generated' | 'critiqued' | 'rewritten' | 'approved' | 'rejected' | 'posted'),
  created_at

platform_variants
  id, draft_id (fk), platform ('linkedin' | 'x'),
  content,                    -- the chosen full draft for this platform
  hook_alternatives jsonb,    -- the 2-3 candidate hooks generated (Section 5.3),
                              --   so the user/UI can swap the chosen hook
  score jsonb (rubric scores: hook_strength, clarity, authenticity, cta_presence, formatting_fit),
  critique_notes text,
  created_at
  -- One row per platform per draft version. `hook_alternatives` holds the
  --   candidate hooks; the winning hook lives at the top of `content`.
  --   (A future A/B test could instead materialize multiple rows — out of
  --   scope for MVP.)

post_events
  id, platform_variant_id (fk), action ('posted' | 'retry' | 'discarded'),
  retry_reason ('too_salesy' | 'weak_hook' | 'not_authentic' | 'other' | null),
  external_post_id (nullable), external_post_url (nullable),
  created_at

news_cache
  id, category, headline, source_url, summary, fetched_at
```

Key design choice: every regenerate creates a new `drafts` row (versioned), and every rejection is logged with a `retry_reason`. This is what makes the future "learn from the user's own style" loop possible — don't skip this even though nothing consumes it yet.

---

## 5. Core User Flow

### 5.1 Brainstorm
- Freeform text input: "what's on your mind" — sent directly to the agent as a seed idea.
- **OR** News-seeded: user picks a category filter (Tech, Entertainment, Business, Science, etc.), sees a feed of recent headlines pulled from RSS, selects one as a seed.
- Either path produces a `ideas` row with `status = 'draft'`.

### 5.2 Idea finalization
- User can iterate on the raw idea conversationally with the agent (angle, tone, key point) before locking it in.
- "Finalize" sets `ideas.status = 'finalized'` and triggers the fan-out.

### 5.3 Agent fan-out (draft generation)
- A **Server Action** fans out one Groq call per platform with `Promise.all`, streaming each draft back to the client as it lands. (No Inngest / queue here — the fan-out is two concurrent calls; Inngest is reserved for Phase 3 scheduled publishing.)
- Each call runs a **platform-specific prompt** (see Section 6) that:
  1. Generates 2–3 hook variants for that platform
  2. Picks the strongest structure for that platform (single post vs. narrative — see Section 6 for the per-platform structure rules)
  3. Produces a full draft, leading with the chosen hook
- Result: one `drafts` row (new version), with one `platform_variants` row per platform. The 2–3 candidate hooks are stored in that row's `hook_alternatives` (Section 4).

### 5.4 Review/improvement loop
- Each variant is scored against a rubric (implemented as a structured LLM critique call, not a black-box "virality score"):
  - Hook strength
  - Clarity
  - Authenticity / AI-tell removal
  - CTA presence (or intentional absence)
  - Platform formatting fit (line breaks, length, hashtag usage; for X in MVP, that it reads as a complete single post)
- If score is below threshold on any axis, auto-trigger one rewrite pass with the critique fed back in. Cap auto-rewrites at 1–2 passes — don't loop silently forever.
- Store `critique_notes` so the user can see *why* a rewrite happened.

### 5.5 Human-in-the-loop (HITL)
- User sees both platform drafts side by side, each with its score breakdown and critique notes visible (collapsible, not forced).
- Actions per platform variant:
  - **Post** → hands off to the platform adapter
  - **Retry** → user picks a quick reason chip (too salesy / weak hook / not authentic / other) → triggers a new generation pass with that feedback injected into the prompt
  - **Edit manually** → inline editable draft, saved as a new version on save
  - **Discard** → logged, no further action

### 5.6 Publish
- **X:** MVP uses X Web Intents (`https://x.com/intent/tweet?text=...`) — official, free, zero API cost, **single post only**. Opens X's own compose box pre-filled; user does the final click. Log the `post_events` row as `'posted'` optimistically once the intent link is opened (there's no callback confirming the post succeeded via this method — call this out clearly in the UI, e.g., a "Did this post? ✓" confirm toggle).
- **LinkedIn:** Full OAuth + API integration from day one (not a stopgap) — see Section 7.

---

## 6. Platform-Specific Prompting

Do not use one generation prompt reformatted per platform. Each platform gets its own system prompt with distinct guidance baked in:

**X (MVP — single post only):**
- Punchy, front-loaded hook in the first line (no preamble)
- **Single post, within the character limit** — MVP publishes via X Web Intents, which can only pre-fill one tweet (Section 5.6/7). The prompt must fit the idea into one strong post, not a thread.
- Reply-bait / opinion-forward framing performs differently than LinkedIn's narrative style
- Aggressively cut filler; every line should justify its own existence
- **Deferred (real X API adapter only):** thread support — when a topic needs more than one post, structure it as numbered thread beats. Do **not** generate threads in MVP; there's no way to publish them via Web Intents.

**LinkedIn:**
- First 2–3 lines are what's visible before "see more" truncation — that's the real hook, optimize for it specifically
- Narrative/story arc structure rewards dwell time and comments more than pure information density
- Comments are weighted more heavily than likes by LinkedIn's ranking — end with a genuine discussion prompt, not a generic "thoughts?"
- Line breaks matter for scannability (short paragraphs, not dense blocks)

Both prompts should share the same "authenticity" pass: strip AI-tells (em-dash overuse, "In today's fast-paced world," generic listicle openers, hedging language) as an explicit critique-loop rubric item, not left to chance.

---

## 7. Platform Adapters (Adapter Pattern)

```ts
interface PlatformAdapter {
  getAuthUrl(userId: string): string
  handleOAuthCallback(code: string): Promise<OAuthToken>
  refreshToken(token: OAuthToken): Promise<OAuthToken>
  publish(draft: PlatformVariant, token: OAuthToken): Promise<PostResult>
}
```

**LinkedIn adapter:**

> ⚠️ **Verify against current LinkedIn docs before building.** LinkedIn's API surface, endpoints, and scope names change often, and the specifics below may be stale relative to what's live today. Confirm endpoints, headers, and scopes in the LinkedIn Developer Portal / current API docs first — do not treat the values here as authoritative.

- Auth: "Sign In with LinkedIn" (OpenID Connect) + "Share on LinkedIn" product (`w_member_social` scope) — both free, self-serve, no partner approval needed, available immediately after creating an app in the LinkedIn Developer Portal. Sign-in scopes are now the OIDC set `openid profile email` (the older `r_liteprofile`/`r_emailaddress` scopes are deprecated).
- Publish: prefer the current **Posts API** — `POST https://api.linkedin.com/rest/posts` with a `LinkedIn-Version: <YYYYMM>` header — which supersedes the legacy `POST /v2/ugcPosts` (`X-Restli-Protocol-Version: 2.0.0`). Use `ugcPosts` only as a documented fallback if the Posts API isn't available for the app. Text-only posts first; image/video support (via the images/`registerUpload` flow) can come later.
- Token lifecycle: access tokens expire in ~60 days, refresh tokens last ~365 days — the adapter must implement a refresh flow, not assume a one-time connect.
- Rate limits: roughly 100 calls/day/member — irrelevant at personal-creator volume, no special handling needed for MVP.
- **Note:** `w_member_social` only covers posting to the *user's own personal profile*. Company page posting requires `w_organization_social` under the gated Community Management API — do not build for this in MVP.

**X adapter (MVP):**
- No OAuth, no backend call. The "adapter" is effectively a URL builder: constructs the single-post `intent/tweet` URL from the approved draft and opens it client-side.
- Because there's no auth, this adapter's `getAuthUrl` / `handleOAuthCallback` / `refreshToken` are **intentional no-ops** (throw a clear "not supported for Web Intents" error) — the interface is implemented in full so the contract stays stable, not because those paths do anything yet.
- Design the adapter interface so a future "XApiAdapter" (using the real pay-per-use API, `$0.015`/post, with thread support) can be swapped in without changing the orchestrator or UI contract — same `publish()` signature, different implementation.

---

## 8. Design & UI/UX Direction

The product should feel calm, precise, and content-first — closer to a writing tool than a dashboard. Reference points: **Notion** (typography-led, generous whitespace, quiet UI chrome that gets out of the way of content), **Vercel** (dark-mode-first, sharp geometric accents, confident use of monospace for technical elements), **Apple** (restraint — every element earns its place, motion is purposeful not decorative).

**Concrete direction:**
- **Typography-first layout.** The draft text itself should be the visual hero of the review screen — not buried under chrome. Large, comfortable reading type for draft content; smaller, muted UI labels around it.
- **Dark mode as default**, with a clean light mode — both should use a restrained palette (near-black/near-white base, one accent color used sparingly for primary actions and score indicators, not decorative gradients everywhere).
- **Motion with purpose, not decoration.** Draft regeneration, score updates, and platform-switching should animate smoothly (Framer Motion) to reinforce state changes — not looping ambient animation for its own sake.
- **Side-by-side platform comparison view** for the HITL screen is the single most important layout to get right — this is the product's core moment. Treat it like Notion's document view: focused, minimal distraction, actions available but not loud.

**Component inspiration (from ui.aceternity.com — free, Tailwind + Framer Motion, shadcn-compatible):**
- **Bento Grid** — good fit for the dashboard/home view (idea sources, recent drafts, connected accounts as bento cells)
- **Timeline** — good fit for visualizing draft version history (v1 → critique → v2 → approved)
- **Floating Dock** — could work as a persistent quick-action bar (new idea, drafts, connections)
- **Animated Tooltip** — for score breakdowns on hover in the review screen
- **Text Generate Effect** — subtle typewriter-style reveal when a draft streams in from the agent (use sparingly, only on first generation, not on every re-render)
- Avoid the more decorative/marketing-site components (3D Pin, Wavy Background, Sparkles, Aurora Background, Hero Parallax) — those suit a landing page, not the working product surface. Fine to use one on Ren's own marketing/landing page, not inside the app itself.
- Also check **Mobbin** for real product screenshots of similar review/approval flows (e.g., content moderation queues, PR review UIs, Linear's issue detail view) for interaction pattern reference beyond raw components.

**Design system foundation:** shadcn/ui + Tailwind, since Aceternity's blocks are shadcn-compatible. Establish a small design token set early (spacing scale, type scale, one accent color, radius scale) rather than letting each screen invent its own values.

---

## 9. Phased Build Order

**Phase 1 — Core loop, no real publishing**
1. Next.js scaffold (Vercel) + Clerk auth + Prisma/Neon schema (Section 4). *No Inngest yet — deferred to Phase 3.*
2. Brainstorm input → idea finalize → agent draft fan-out via a **Server Action** (`Promise.all` over the LinkedIn + X prompts, Section 6), calling Groq (`gpt-oss-120b` primary), streaming drafts back to the client
3. Critique/rewrite loop (rubric scoring + auto-rewrite pass)
4. HITL review screen (the core UI moment — invest design time here first)
5. "Post" action just marks `post_events` and opens X intent link / copies LinkedIn draft to clipboard (no real LinkedIn API yet)

**Phase 2 — Real publishing**
6. LinkedIn OAuth + Share on LinkedIn adapter (Section 7)
7. Retry-reason capture wired into regeneration prompt
8. News ingestion (RSS by category) feeding the brainstorm screen

**Phase 3 — Polish & scheduling**
9. **Introduce Inngest** — scheduled functions for timed publishing (cron-style + delayed triggers). This is the first point Inngest enters the stack.
10. Draft version timeline UI
11. Full design pass using the component/motion direction in Section 8

**Explicitly deferred:** analytics-driven style fine-tuning (needs Phase 2 data to accumulate first), X's real paid API adapter (swap-in later, same interface), team/company-page support.

---

## 10. Notes for Claude Code

- Keep the platform adapter interface stable from the first commit — Phase 1's fake X adapter and Phase 2's real LinkedIn adapter should implement the exact same `PlatformAdapter` interface described in Section 7, so swapping implementations never touches the orchestrator or UI.
- Every draft regeneration must create a new versioned row, never overwrite — this is a hard requirement, not a nice-to-have (Section 4).
- Do not build a "virality score" — build the explicit rubric (Section 5.4) and be transparent in the UI about what it measures.
- Encrypt OAuth tokens at rest in `oauth_connections`; do not log raw tokens.
- Prioritize the HITL review screen's visual quality above all other screens — it's the product's signature moment and should get the most design iteration.
- Build the Groq client as model-agnostic (a thin wrapper accepting a model name), not hardcoded to one model — this lets the app route drafting/critique to `gpt-oss-120b` and lighter rewrite passes to `llama-3.3-70b-versatile`, using their separate per-model rate-limit pools instead of exhausting one shared quota.
- Keep Clerk (app login) and platform OAuth (LinkedIn/X posting permission) as clearly separate systems in code — a `users` row (Clerk-backed) can have zero or more `oauth_connections` rows, never conflate the two.
- This project runs on **Next.js 16** (App Router). Before writing any framework code, read the vendored docs at `node_modules/next/dist/docs/` (per `AGENTS.md`) — Next 16 has breaking changes vs. older App Router that predate most training data (e.g. async `params`/`searchParams`, caching defaults, Server Action conventions). Don't assume older-Next behavior.
- Draft generation is a **Server Action with `Promise.all`**, not a background job — do not reach for Inngest until Phase 3 (scheduled publishing). Streaming the draft reveal (Section 8) depends on generation running in-request, so keep it there.
