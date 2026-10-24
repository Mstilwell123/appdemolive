import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, bootDb, createUser, seedAppAndLaunch } from "./db";

let db: PGlite;
let alice: { userId: string; orgId: string };
let bob: { userId: string; orgId: string };

beforeAll(async () => {
  db = await bootDb();
  alice = await createUser(db, "alice-ai@example.com", "Alice AI");
  bob = await createUser(db, "bob-ai@example.com", "Bob AI");
});

const run = (orgId: string, launchId: string | null, task = "generate_launch_strategy") =>
  db.query<{ id: string }>(
    "insert into public.ai_runs (organization_id, launch_id, task_type, source, model, prompt_version) values ($1, $2, $3, 'openai', 'gpt-4o-mini', 'v1') returning id",
    [orgId, launchId, task],
  );

describe("Phase 3 AI tables", () => {
  it("allows only one running run per launch and task, so preparation can't start twice", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "ai-lock");
    const first = await run(alice.orgId, launchId);
    await expect(run(alice.orgId, launchId)).rejects.toThrow();
    await run(alice.orgId, launchId, "generate_runbook"); // a different task is fine
    await db.query("update public.ai_runs set status = 'succeeded' where id = $1", [first.rows[0].id]);
    await run(alice.orgId, launchId); // lock released once finished
    await run(alice.orgId, null, "analyze_product");
    await run(alice.orgId, null, "analyze_product"); // intake analyses have no launch and no lock
  });

  it("versions strategies and runbooks and allows only one approved of each", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "ai-versions");
    const ins = (v: number, status: string) =>
      db.query("insert into public.launch_strategies (organization_id, launch_id, version, status, strategy) values ($1, $2, $3, $4, '{}')", [alice.orgId, launchId, v, status]);
    await ins(1, "approved");
    await expect(ins(1, "draft")).rejects.toThrow(); // same version twice
    await expect(ins(2, "approved")).rejects.toThrow(); // second approved
    await ins(2, "draft");
    const rb = (v: number, status: string) =>
      db.query("insert into public.launch_runbooks (organization_id, launch_id, version, status, title, duration_minutes) values ($1, $2, $3, $4, 'Show', 30)", [alice.orgId, launchId, v, status]);
    const r1 = await db.query<{ id: string }>("insert into public.launch_runbooks (organization_id, launch_id, version, status, title, duration_minutes) values ($1, $2, 1, 'approved', 'Show', 30) returning id", [alice.orgId, launchId]);
    await expect(rb(2, "approved")).rejects.toThrow();
    await expect(rb(3, "draft").then(() => db.query("insert into public.launch_runbooks (organization_id, launch_id, version, title, duration_minutes) values ($1, $2, 4, 'Show', 2)", [alice.orgId, launchId]))).rejects.toThrow(); // under 5 minutes
    await db.query("update public.launches set runbook_id = $1 where id = $2", [r1.rows[0].id, launchId]);
  });

  it("rejects a strategy for a launch in another organization", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "ai-cross");
    await expect(
      db.query("insert into public.launch_strategies (organization_id, launch_id, version, strategy) values ($1, $2, 1, '{}')", [bob.orgId, launchId]),
    ).rejects.toThrow();
  });

  it("lets members read their own AI records, hides them from other orgs, and blocks client writes", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "ai-rls");
    await run(alice.orgId, launchId, "analyze_product");
    await db.query("insert into public.launch_strategies (organization_id, launch_id, version, strategy) values ($1, $2, 1, '{}')", [alice.orgId, launchId]);
    await db.query("insert into public.launch_runbooks (organization_id, launch_id, version, title, duration_minutes) values ($1, $2, 1, 'Show', 30)", [alice.orgId, launchId]);
    for (const t of ["ai_runs", "launch_strategies", "launch_runbooks"]) {
      const mine = await asUser(db, alice.userId, () => db.query(`select id from public.${t} where launch_id = $1`, [launchId]));
      expect(mine.rows.length, t).toBe(1);
      const theirs = await asUser(db, bob.userId, () => db.query(`select id from public.${t} where launch_id = $1`, [launchId]));
      expect(theirs.rows.length, t).toBe(0);
    }
    await expect(asUser(db, alice.userId, () => run(alice.orgId, launchId, "generate_runbook"))).rejects.toThrow();
    await expect(asUser(db, alice.userId, () => db.query("update public.launch_strategies set status = 'approved' where launch_id = $1", [launchId]))).rejects.toThrow();
  });
});
