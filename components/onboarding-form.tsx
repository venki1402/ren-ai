"use client";

import { useState } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { cn } from "@/lib/utils";
import {
  PERSONAS,
  PERSONA_CONTEXT_FIELDS,
  PERSONA_DESCRIPTIONS,
  PERSONA_LABELS,
  type PersonaId,
} from "@/lib/persona-shared";
import { savePersona, skipOnboarding } from "@/app/actions/persona";

// Post-signup persona capture. Persona shapes the *voice* of every draft; the
// optional context lets posts reference real specifics. Skippable — Ren still
// works, it just leans on a neutral generalist voice until this is filled in.
export function OnboardingForm() {
  const [persona, setPersona] = useState<PersonaId>("generalist");
  const [showContext, setShowContext] = useState(false);

  return (
    <form action={savePersona} className="flex flex-col gap-8">
      <input type="hidden" name="persona" value={persona} />

      <fieldset>
        <legend className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Which sounds most like you?
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {PERSONAS.map((id) => {
            const selected = persona === id;
            return (
              <button
                type="button"
                key={id}
                onClick={() => setPersona(id)}
                aria-pressed={selected}
                className={cn(
                  "flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors",
                  selected
                    ? "border-accent bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]"
                    : "border-border bg-card hover:border-[color-mix(in_oklch,var(--accent)_45%,var(--border))]",
                )}
              >
                <span className="flex items-center justify-between text-sm font-medium">
                  {PERSONA_LABELS[id]}
                  {selected && <Check className="size-4 text-accent" />}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {PERSONA_DESCRIPTIONS[id]}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <button
          type="button"
          onClick={() => setShowContext((s) => !s)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", showContext && "rotate-180")}
          />
          Add a little context (optional)
        </button>
        {showContext && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {PERSONA_CONTEXT_FIELDS.map(({ key, label, placeholder }) => (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">{label}</span>
                <input
                  type="text"
                  name={key}
                  placeholder={placeholder}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                />
              </label>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Context helps Ren write from your real point of view — it never gets
          pasted into posts verbatim, and not every post will mention it.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-6">
        <Button type="submit" variant="ghost" formAction={skipOnboarding}>
          Skip for now
        </Button>
        <SubmitButton pendingText="Saving…">
          Continue
          <ArrowRight />
        </SubmitButton>
      </div>
    </form>
  );
}
