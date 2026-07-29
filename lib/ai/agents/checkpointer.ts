import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Durable checkpointer for the LangGraph pipeline. PostgresSaver persists graph
// state after each node to Neon (its own `checkpoints*` tables, external to
// Prisma), so a crashed or timed-out run resumes from the last completed node
// instead of restarting. Single lazy instance per process; `.setup()` (DDL) is
// run once — idempotent, but prefer `npm run db:checkpointer` at deploy time.

let saver: PostgresSaver | null = null;
let setupPromise: Promise<void> | null = null;

export function getCheckpointer(): PostgresSaver {
  if (!saver) {
    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error("DATABASE_URL is not set");
    saver = PostgresSaver.fromConnString(conn);
  }
  return saver;
}

/** Ensure checkpoint tables exist. Guarded so the DDL runs at most once/process. */
export async function ensureCheckpointerSetup(): Promise<void> {
  if (!setupPromise) setupPromise = getCheckpointer().setup();
  await setupPromise;
}
