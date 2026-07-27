import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[color-mix(in_oklch,var(--background)_85%,transparent)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-accent text-[13px] font-semibold text-accent-foreground">
            連
          </span>
          <span className="text-sm font-semibold tracking-tight">Ren</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/settings"
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Settings
          </Link>
          <UserButton appearance={{ elements: { avatarBox: "size-7" } }} />
        </div>
      </div>
    </header>
  );
}
