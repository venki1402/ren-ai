import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitBranch } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { IdeaComposer } from "@/components/idea-composer";
import {
  VariantCard,
  type VariantView,
} from "@/components/review/variant-card";
import { requireUser } from "@/lib/auth";
import { isConnected } from "@/lib/oauth";
import { getIdeaDetail, type IdeaDetail } from "@/lib/queries";
import { parseScore } from "@/lib/score";
import { PLATFORM_LABELS, type PlatformId } from "@/lib/platforms";

// Idea detail. Two states:
//   - No drafts yet  → refine + finalize (IdeaComposer).
//   - Drafts exist   → the HITL review screen (doc Section 5.5) — the product's
//     signature moment: side-by-side platform comparison, scores, critique, and
//     per-variant actions.
export default async function IdeaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const idea = await getIdeaDetail(id, user.id);
  if (!idea) notFound();

  const linkedinConnected = await isConnected(user.id, "linkedin");
  const latest = idea.drafts[0];

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All ideas
        </Link>

        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {idea.source === "news" ? "News-seeded idea" : "Idea"}
            </p>
            <h1 className="mt-1 text-xl font-semibold leading-relaxed tracking-tight">
              {idea.seedText}
            </h1>
            {idea.seedNewsUrl && (
              <a
                href={idea.seedNewsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-accent hover:underline"
              >
                Source article
              </a>
            )}
          </div>
          {latest && <Badge variant="accent">Version {latest.version}</Badge>}
        </div>

        {latest ? (
          <ReviewBoard
            latest={latest}
            versions={idea.drafts}
            linkedinConnected={linkedinConnected}
          />
        ) : (
          <IdeaComposer ideaId={idea.id} initialSeed={idea.seedText} />
        )}
      </main>
    </div>
  );
}

type LatestDraft = IdeaDetail["drafts"][number];

function toView(v: LatestDraft["platformVariants"][number]): VariantView {
  const posted = v.postEvents.some((e) => e.action === "posted");
  const discarded =
    !posted && v.postEvents.some((e) => e.action === "discarded");
  return {
    id: v.id,
    platform: v.platform,
    content: v.content,
    hookAlternatives: Array.isArray(v.hookAlternatives)
      ? (v.hookAlternatives as string[])
      : [],
    score: parseScore(v.score),
    critiqueNotes: v.critiqueNotes,
    citations: Array.isArray(v.citations)
      ? (v.citations as VariantView["citations"])
      : [],
    posted,
    discarded,
  };
}

function ReviewBoard({
  latest,
  versions,
  linkedinConnected,
}: {
  latest: LatestDraft;
  versions: IdeaDetail["drafts"];
  linkedinConnected: boolean;
}) {
  const variants = latest.platformVariants.map(toView);

  return (
    <div className="flex flex-col gap-10">
      {/* Side-by-side platform comparison — the core layout (doc Section 8) */}
      <div className="grid gap-5 lg:grid-cols-2">
        {variants.map((v) => (
          <VariantCard
            key={v.id}
            variant={v}
            linkedinConnected={linkedinConnected}
          />
        ))}
      </div>

      {versions.length > 1 && <VersionTimeline versions={versions} />}
    </div>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function VersionTimeline({ versions }: { versions: IdeaDetail["drafts"] }) {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        <GitBranch className="size-3.5" /> Version history
      </h2>
      <ol className="flex flex-col gap-3">
        {versions.map((draft, i) => {
          const platforms = [
            ...new Set(draft.platformVariants.map((v) => v.platform)),
          ];
          return (
            <li key={draft.id} className="flex items-center gap-3 text-sm">
              <span
                className={
                  i === 0
                    ? "size-2 shrink-0 rounded-full bg-accent"
                    : "size-2 shrink-0 rounded-full bg-border"
                }
              />
              <span className="font-medium tabular-nums">
                v{draft.version}
              </span>
              <span className="text-muted-foreground">{draft.status}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {platforms
                  .map((p) => PLATFORM_LABELS[p as PlatformId])
                  .join(", ")}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {dateFmt.format(draft.createdAt)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
