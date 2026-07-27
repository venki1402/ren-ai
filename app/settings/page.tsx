import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, Check } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ThemeSelector } from "@/components/theme-selector";
import { requireUser } from "@/lib/auth";
import { isConnected } from "@/lib/oauth";
import { disconnectPlatform } from "@/app/actions/connections";
import { ACCENTS, DEFAULT_ACCENT, type AccentId } from "@/lib/theme";

// Settings (doc Sections 7 & 8). Two sections for now — Connections (platform
// posting permissions, kept separate from Clerk app login per Note 10) and
// Theme (the single accent color). More can be added later.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const [user, sp, jar] = await Promise.all([
    requireUser(),
    searchParams,
    cookies(),
  ]);
  const linkedinConnected = await isConnected(user.id, "linkedin");
  const cookieAccent = jar.get("ren-accent")?.value;
  const accent: AccentId =
    cookieAccent && cookieAccent in ACCENTS
      ? (cookieAccent as AccentId)
      : DEFAULT_ACCENT;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Home
        </Link>

        <h1 className="mb-8 text-xl font-semibold tracking-tight">Settings</h1>

        {sp.connected === "linkedin" && (
          <Notice tone="good">
            LinkedIn connected — you can now post directly.
          </Notice>
        )}
        {sp.error && <Notice tone="bad">{errorMessage(sp.error)}</Notice>}

        {/* ─── Connections ─────────────────────────────────────────── */}
        <Section
          title="Connections"
          description="Grant Ren permission to post on your behalf. These are separate from your Ren sign-in."
        >
          {/* LinkedIn — real OAuth */}
          <Row
            icon={
              <span className="grid size-9 place-items-center rounded-lg bg-[#0a66c2] text-sm font-bold text-white">
                in
              </span>
            }
            name="LinkedIn"
            detail="Post to your personal profile via the LinkedIn API."
          >
            {linkedinConnected ? (
              <div className="flex items-center gap-3">
                <Badge variant="accent">
                  <Check className="size-3" /> Connected
                </Badge>
                <form action={disconnectPlatform.bind(null, "linkedin")}>
                  <Button type="submit" variant="ghost" size="sm">
                    Disconnect
                  </Button>
                </form>
              </div>
            ) : (
              <a
                href="/api/oauth/linkedin"
                className={buttonVariants({ size: "sm" })}
              >
                Connect
              </a>
            )}
          </Row>

          {/* X — connection not available yet (MVP posts via Web Intents) */}
          <Row
            icon={
              <span className="grid size-9 place-items-center rounded-lg bg-muted text-sm font-semibold">
                𝕏
              </span>
            }
            name="X"
            detail="Connect an X account to post directly. Coming soon — for now, posts open in X's composer."
          >
            <div className="flex items-center gap-3">
              <Badge variant="outline">Coming soon</Badge>
              <Button size="sm" disabled title="Not available yet">
                Connect
              </Button>
            </div>
          </Row>
        </Section>

        {/* ─── Theme ───────────────────────────────────────────────── */}
        <Section
          title="Theme"
          description="Pick the accent color used for primary actions and score indicators."
        >
          <ThemeSelector current={accent} />
        </Section>
      </main>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({
  icon,
  name,
  detail,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function errorMessage(code: string): string {
  switch (code) {
    case "denied":
      return "LinkedIn authorization was cancelled.";
    case "state":
      return "The connection request expired or didn't match. Please try again.";
    case "exchange":
      return "Couldn't complete the LinkedIn connection. Please try again.";
    default:
      return "Something went wrong connecting LinkedIn.";
  }
}

function Notice({
  tone,
  children,
}: {
  tone: "good" | "bad";
  children: React.ReactNode;
}) {
  return (
    <div
      className="mb-6 rounded-lg border px-4 py-3 text-sm"
      style={{
        borderColor: `color-mix(in oklch, var(--${tone}) 40%, transparent)`,
        background: `color-mix(in oklch, var(--${tone}) 10%, transparent)`,
        color: `var(--${tone})`,
      }}
    >
      {children}
    </div>
  );
}
