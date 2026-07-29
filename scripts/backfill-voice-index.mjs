// Backfill the voice index (post_embeddings) from posts that were already
// marked posted before ingestion existed. Self-contained (raw pg + local
// embeddings) so it runs with `node scripts/backfill-voice-index.mjs` — no
// build step, no @/ alias. Idempotent: skips variants already indexed.

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pipeline } from "@xenova/transformers";
import pg from "pg";

const AXES = [
  "hook_strength",
  "clarity",
  "authenticity",
  "cta_presence",
  "formatting_fit",
  "voice_fit",
];

function overall(score) {
  if (!score || typeof score !== "object") return null;
  const present = AXES.filter((a) => typeof score[a] === "number");
  if (!present.length) return null;
  return present.reduce((s, a) => s + score[a], 0) / present.length;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
  SELECT pv.id, pv.content, pv.platform, pv.score, i.user_id AS user_id
  FROM platform_variants pv
  JOIN drafts d ON d.id = pv.draft_id
  JOIN ideas i ON i.id = d.idea_id
  WHERE EXISTS (
    SELECT 1 FROM post_events pe
    WHERE pe.platform_variant_id = pv.id AND pe.action = 'posted'
  )
  AND NOT EXISTS (
    SELECT 1 FROM post_embeddings emb WHERE emb.platform_variant_id = pv.id
  )
`);

console.log(`Found ${rows.length} posted variant(s) to index.`);
if (rows.length === 0) {
  await client.end();
  process.exit(0);
}

const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
const embed = async (t) =>
  Array.from((await extractor(t, { pooling: "mean", normalize: true })).data);

let done = 0;
for (const r of rows) {
  const vec = `[${(await embed(r.content)).join(",")}]`;
  await client.query(
    `INSERT INTO post_embeddings
       (id, user_id, platform_variant_id, platform, content, score, embedding)
     VALUES ($1, $2, $3, $4::"Platform", $5, $6, $7::vector)
     ON CONFLICT (platform_variant_id) DO NOTHING`,
    [randomUUID(), r.user_id, r.id, r.platform, r.content, overall(r.score), vec],
  );
  done += 1;
  process.stdout.write(`\rIndexed ${done}/${rows.length}`);
}

console.log(`\nDone — indexed ${done} variant(s).`);
await client.end();
