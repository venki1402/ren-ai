// One-time setup of the LangGraph Postgres checkpointer tables on Neon.
// Idempotent (CREATE TABLE IF NOT EXISTS + internal migrations). Run at deploy
// time so the app doesn't do DDL on a request path: `npm run db:checkpointer`.

import "dotenv/config";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const conn = process.env.DATABASE_URL;
if (!conn) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const checkpointer = PostgresSaver.fromConnString(conn);
await checkpointer.setup();
console.log("✓ LangGraph checkpointer tables ready");
process.exit(0);
