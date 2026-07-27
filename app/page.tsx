import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { SubmitButton } from "@/components/submit-button";
import { NewsBrainstorm } from "@/components/news-brainstorm";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { createIdea } from "@/app/actions/ideas";
import { requireUser } from "@/lib/auth";
import { getIdeasForUser, type IdeaListItem } from "@/lib/queries";
import { PLATFORM_LABELS, type PlatformId } from "@/lib/platforms";

// Home / dashboard (doc Section 5.1 + 8). Two things only: a calm brainstorm
// input as the hero, and the list of recent ideas. Content-first, quiet chrome.
export default async function Home() {
  const user = await requireUser();
  // First-time users see the (skippable) persona step before the dashboard.
  if (!user.onboardedAt) redirect("/onboarding");
  const ideas = await getIdeasForUser(user.id);

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <section className="mb-14">
          <div className="mb-6 flex items-center gap-2 text-muted-foreground">
            <Sparkles className="size-4 text-accent" />
            <span className="text-xs font-medium uppercase tracking-widest">
              Brainstorm
            </span>
          </div>
          <h1 className="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl">
            What&apos;s on your mind?
          </h1>
          <form action={createIdea} className="flex flex-col gap-3">
            <Textarea
              name="seedText"
              required
              rows={4}
              placeholder="A raw idea, a take, a lesson learned, a thread you keep coming back to…"
              className="min-h-32 text-base leading-relaxed"
              autoFocus
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                One idea, tuned for {PLATFORM_LABELS.linkedin} and{" "}
                {PLATFORM_LABELS.x}.
              </p>
              <SubmitButton pendingText="Starting…">
                Start drafting
                <ArrowRight />
              </SubmitButton>
            </div>
          </form>
        </section>

        <section className="mb-14">
          <NewsBrainstorm />
        </section>

        <section>
          <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Recent ideas
          </h2>
          {ideas.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
              Nothing yet. Your ideas will collect here as you draft them.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ideas.map((idea) => (
                <IdeaRow key={idea.id} idea={idea} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  finalized: "In review",
  archived: "Archived",
};

function IdeaRow({ idea }: { idea: IdeaListItem }) {
  const latest = idea.drafts[0];
  const platforms = latest
    ? [...new Set(latest.platformVariants.map((v) => v.platform))]
    : [];

  return (
    <li>
      <Link
        href={`/ideas/${idea.id}`}
        className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-[color-mix(in_oklch,var(--accent)_45%,var(--border))]"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-relaxed text-card-foreground">
            {idea.seedText}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={idea.status === "draft" ? "outline" : "accent"}>
              {STATUS_LABELS[idea.status] ?? idea.status}
            </Badge>
            {platforms.map((p) => (
              <span
                key={p}
                className="text-xs text-muted-foreground"
              >
                {PLATFORM_LABELS[p as PlatformId]}
              </span>
            ))}
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </Link>
    </li>
  );
}
