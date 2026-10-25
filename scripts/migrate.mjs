// Applies db/migrations in order, or rolls back the latest one with its db/rollbacks/*.down.sql.
//   npm run db:migrate            apply every pending migration
//   npm run db:rollback           undo the most recently applied migration
// Reads DATABASE_URL from the environment (use a Neon dev branch or local Postgres, never production).
// Each file runs in its own transaction and is recorded in public.schema_migrations.
import { Pool, neonConfig } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ws from "ws";

neonConfig.webSocketConstructor ??= ws;
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const mode = process.argv[2] ?? "up";
if (!["up", "rollback"].includes(mode)) {
  console.error(`Unknown mode "${mode}". Use "up" or "rollback".`);
  process.exit(1);
}

const root = join(import.meta.dirname, "..", "db");
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await client.query("select name from public.schema_migrations")).rows.map((r) => r.name));
  if (mode === "up") {
    const pending = readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();
    for (const file of pending) {
      await client.query("begin");
      try {
        await client.query(readFileSync(join(root, "migrations", file), "utf8"));
        await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`applied ${file}`);
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
    if (!pending.length) console.log("up to date");
  } else {
    const last = [...applied].sort().at(-1);
    if (!last) {
      console.log("nothing to roll back");
    } else {
      const down = readFileSync(join(root, "rollbacks", last.replace(/\.sql$/, ".down.sql")), "utf8");
      await client.query("begin");
      try {
        await client.query(down);
        await client.query("delete from public.schema_migrations where name = $1", [last]);
        await client.query("commit");
        console.log(`rolled back ${last}`);
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
  }
} catch (e) {
  console.error(`migration failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
