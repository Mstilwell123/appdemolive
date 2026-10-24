import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Boots an in-memory Postgres with the Supabase shim and every migration applied. */
export async function bootDb() {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-shim.sql"), "utf8"));
  // Mirror Supabase: API roles get privileges on every new table and function by default,
  // so migrations must explicitly revoke anything they want closed.
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);
  const dir = join(__dirname, "..", "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return db;
}

/** Runs fn as a signed-in Supabase user (role authenticated, auth.uid() = userId). */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export async function createUser(db: PGlite, email: string, org: string) {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: email.split("@")[0], organization_name: org })],
  );
  const userId = r.rows[0].id;
  const m = await db.query<{ organization_id: string }>(
    `select organization_id from public.organization_members where user_id = $1`,
    [userId],
  );
  return { userId, orgId: m.rows[0].organization_id };
}

/** Seeds an app, version 1, a submitted intake and a DRAFT launch as the database owner. */
export async function seedAppAndLaunch(db: PGlite, orgId: string, userId: string, slug: string) {
  const app = await db.query<{ id: string }>(
    "insert into public.apps (organization_id, name, slug, created_by) values ($1, $2, $3, $4) returning id",
    [orgId, slug, slug, userId],
  );
  const ver = await db.query<{ id: string }>(
    "insert into public.app_versions (organization_id, app_id, version_label, version_number, created_by) values ($1, $2, 'v1', 1, $3) returning id",
    [orgId, app.rows[0].id, userId],
  );
  const launch = await db.query<{ id: string }>(
    "insert into public.launches (organization_id, app_id, app_version_id, created_by) values ($1, $2, $3, $4) returning id",
    [orgId, app.rows[0].id, ver.rows[0].id, userId],
  );
  return { appId: app.rows[0].id, versionId: ver.rows[0].id, launchId: launch.rows[0].id };
}

/** Walks a launch through the given statuses as the service role would. */
export async function walk(db: PGlite, launchId: string, steps: Array<[string, string, string]>) {
  for (const [from, to, actor] of steps) {
    await db.query("select public.transition_launch($1, $2, $3, null, $4, null)", [launchId, from, to, actor]);
  }
}
