import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { OnboardingForm } from "@/components/onboarding-form";
import { requireUser } from "@/lib/auth";

// One-time persona capture shown right after sign-up. The gate in app/page.tsx
// routes new users here; once onboardedAt is stamped (Continue or Skip) they're
// never sent back.
export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.onboardedAt) redirect("/");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-16">
      <div className="mb-6 flex items-center gap-2 text-muted-foreground">
        <Sparkles className="size-4 text-accent" />
        <span className="text-xs font-medium uppercase tracking-widest">
          Set up your voice
        </span>
      </div>
      <h1 className="mb-3 text-2xl font-semibold tracking-tight sm:text-3xl">
        Who&apos;s writing?
      </h1>
      <p className="mb-10 text-sm leading-relaxed text-muted-foreground">
        Ren tunes every draft to your point of view. Tell us who you are and
        Ren will carry that voice — without turning every post into a bio.
      </p>
      <OnboardingForm />
    </div>
  );
}
