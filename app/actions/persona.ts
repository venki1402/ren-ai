"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  PERSONAS,
  PERSONA_CONTEXT_FIELDS,
  type PersonaContext,
  type PersonaId,
} from "@/lib/persona-shared";

// Post-signup persona capture (doc Section 5). Skippable — either path stamps
// onboardedAt so the gate in app/page.tsx doesn't show the step again.

function readContext(formData: FormData): PersonaContext {
  const context: PersonaContext = {};
  for (const { key } of PERSONA_CONTEXT_FIELDS) {
    const v = String(formData.get(key) ?? "").trim();
    if (v) context[key] = v;
  }
  return context;
}

export async function savePersona(formData: FormData): Promise<void> {
  const user = await requireUser();

  const raw = String(formData.get("persona") ?? "");
  const persona: PersonaId = (PERSONAS as readonly string[]).includes(raw)
    ? (raw as PersonaId)
    : "generalist";

  const context = readContext(formData);
  const hasContext = Object.keys(context).length > 0;

  await db.user.update({
    where: { id: user.id },
    data: {
      persona,
      // DbNull stores a real SQL NULL (vs. Prisma.JsonNull, a JSON `null`).
      personaContext: hasContext
        ? (context as Prisma.InputJsonObject)
        : Prisma.DbNull,
      onboardedAt: new Date(),
    },
  });

  revalidatePath("/");
  redirect("/");
}

// Wired to a <button formAction>; the passed FormData is intentionally unused.
export async function skipOnboarding(): Promise<void> {
  const user = await requireUser();
  await db.user.update({
    where: { id: user.id },
    data: { onboardedAt: new Date() },
  });
  revalidatePath("/");
  redirect("/");
}
