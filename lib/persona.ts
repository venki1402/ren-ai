import type { User } from "@prisma/client";
import {
  parsePersonaContext,
  type PersonaId,
  type PersonaProfile,
} from "@/lib/persona-shared";

// Server-side bridge: turn a stored `users` row into the PersonaProfile the AI
// layer consumes. The Prisma `Persona` enum mirrors PersonaId one-to-one (see
// prisma/schema.prisma ↔ lib/persona-shared.ts).
export function profileFromUser(user: User): PersonaProfile {
  return {
    persona: user.persona as PersonaId,
    context: parsePersonaContext(user.personaContext),
  };
}
