import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Prisma 7 config. The datasource URL here is used by the Prisma CLI for
// migrations/introspection only — the runtime client connects via a driver
// adapter (see lib/db.ts). Use the DIRECT (non-pooled) Neon URL for migrations.
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
