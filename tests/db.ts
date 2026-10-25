import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Boots an in-memory Postgres with every db/migrations file applied, exactly as `npm run db:migrate` does. */
export async function bootDb() {
  const db = new PGlite();
  const dir = join(__dirname, "..", "db", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return db;
}

/** Creates an account the way sign-up does: a signup intent, then the Better Auth users row (the trigger makes the org). */
export async function createUser(db: PGlite, email: string, org: string) {
  await db.query("insert into public.signup_intents (email, full_name, organization_name) values ($1, $2, $3)", [email, email.split("@")[0], org]);
  const r = await db.query<{ id: string }>("insert into public.users (email, name) values ($1, $2) returning id", [email, email.split("@")[0]]);
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

/** Runs fn with app.user_id set, as services/withActor does for create_app_with_intake and create_next_app_version. */
export async function asActor<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('app.user_id', $1, false)", [userId]);
  try {
    return await fn();
  } finally {
    await db.query("select set_config('app.user_id', '', false)");
  }
}
