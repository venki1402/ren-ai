// Client-safe persona constants & types (no server deps — safe to import in
// client components). The Prisma `Persona` enum mirrors PERSONAS exactly, the
// same way lib/platforms.ts mirrors the `Platform` enum. Prompt construction
// from a profile lives server-side in lib/ai/prompts.ts.

export const PERSONAS = [
  "student",
  "developer",
  "entrepreneur",
  "generalist",
] as const;

export type PersonaId = (typeof PERSONAS)[number];

export const PERSONA_LABELS: Record<PersonaId, string> = {
  student: "Student",
  developer: "Developer",
  entrepreneur: "Entrepreneur",
  generalist: "Generalist",
};

// Shown in the onboarding picker to explain each choice.
export const PERSONA_DESCRIPTIONS: Record<PersonaId, string> = {
  student:
    "Learning in public — sharing what you're figuring out, honestly and curiously.",
  developer:
    "Technical and precise — you show the work and reason from real detail.",
  entrepreneur:
    "Outcome- and vision-oriented — decisive takes on building and shipping.",
  generalist:
    "No fixed lane — clear, versatile writing that adapts to the idea.",
};

// Optional freeform context captured at onboarding. All fields optional; the
// more the creator gives, the more specific their posts can be.
export interface PersonaContext {
  role?: string; // e.g. "SWE", "final-year CS student", "founder"
  org?: string; // e.g. "Acme", "IIT Bombay"
  focus?: string; // what they're working on now, e.g. "a Go migration"
  goal?: string; // why they post, e.g. "landing a placement", "hiring"
}

// The full identity signal passed into generation/critique.
export interface PersonaProfile {
  persona: PersonaId;
  context: PersonaContext | null;
}

export const PERSONA_CONTEXT_FIELDS: {
  key: keyof PersonaContext;
  label: string;
  placeholder: string;
}[] = [
  { key: "role", label: "Role", placeholder: "SWE · final-year CS student · founder" },
  { key: "org", label: "Where", placeholder: "Company, college, or “independent”" },
  { key: "focus", label: "Working on", placeholder: "A Go migration · placement prep · a launch" },
  { key: "goal", label: "Why you post", placeholder: "Land a role · hire · build an audience" },
];

/** True if the profile carries no real signal (default persona, no context). */
export function isEmptyProfile(profile: PersonaProfile): boolean {
  return profile.persona === "generalist" && !hasContext(profile.context);
}

export function hasContext(context: PersonaContext | null): boolean {
  if (!context) return false;
  return PERSONA_CONTEXT_FIELDS.some(({ key }) => {
    const v = context[key];
    return typeof v === "string" && v.trim().length > 0;
  });
}

/** Coerce a stored `Json` persona-context into a clean, typed object (or null). */
export function parsePersonaContext(raw: unknown): PersonaContext | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const out: PersonaContext = {};
  for (const { key } of PERSONA_CONTEXT_FIELDS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return hasContext(out) ? out : null;
}
