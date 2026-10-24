import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { asUser, bootDb, createUser, seedAppAndLaunch } from "./db";

let db: PGlite;
let alice: { userId: string; orgId: string };
let bob: { userId: string; orgId: string };

beforeAll(async () => {
  db = await bootDb();
  alice = await createUser(db, "alice-v14@example.com", "Alice v14");
  bob = await createUser(db, "bob-v14@example.com", "Bob v14");
});

const ROLLBACKS = join(__dirname, "..", "supabase", "rollbacks");
const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");

describe("v1.4 migrations are additive and reversible", () => {
  it("every v1.4 migration has a rollback, and down then up leaves a working schema", async () => {
    const ups = readdirSync(MIGRATIONS).filter((f) => f >= "20261024" && f.endsWith(".sql")).sort();
    expect(ups.length).toBeGreaterThan(0);
    const fresh = await bootDb();
    for (const up of [...ups].reverse()) {
      const down = up.replace(/\.sql$/, ".down.sql");
      await fresh.exec(readFileSync(join(ROLLBACKS, down), "utf8"));
    }
    for (const up of ups) await fresh.exec(readFileSync(join(MIGRATIONS, up), "utf8"));
    await fresh.close();
  });
  it("v1.4 migrations never drop or rename existing objects", () => {
    for (const f of readdirSync(MIGRATIONS).filter((x) => x >= "20261024")) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8").replace(/--.*$/gm, "");
      expect(sql).not.toMatch(/\bdrop\s+(table|column|type|function)\b|\brename\b/i);
    }
  });
});

describe("R3 truth sheets", () => {
  const ins = (orgId: string, launchId: string, version: number, status = "draft", by: string | null = null) =>
    db.query("insert into public.launch_truth_sheets (organization_id, launch_id, version, status, items, approved_by, approved_at) values ($1,$2,$3,$4,'[]',$5,$6)",
      [orgId, launchId, version, status, by, by ? new Date().toISOString() : null]);

  it("versions, allows one approved, and requires an approver", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "ts-v");
    await ins(alice.orgId, launchId, 1, "approved", alice.userId);
    await expect(ins(alice.orgId, launchId, 1)).rejects.toThrow();
    await expect(ins(alice.orgId, launchId, 2, "approved", alice.userId)).rejects.toThrow();
    await expect(ins(alice.orgId, launchId, 3, "approved", null)).rejects.toThrow();
    await expect(db.query("insert into public.launch_truth_sheets (organization_id, launch_id, version, items) values ($1,$2,9,'{}')", [alice.orgId, launchId])).rejects.toThrow();
  });
  it("rejects a sheet tied to another org's launch", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "ts-x");
    await expect(ins(bob.orgId, launchId, 1)).rejects.toThrow();
  });
  it("members read their own; other orgs see nothing; clients can't write", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "ts-rls");
    await ins(alice.orgId, launchId, 1);
    const own = await asUser(db, alice.userId, () => db.query("select id from public.launch_truth_sheets where launch_id = $1", [launchId]));
    expect(own.rows).toHaveLength(1);
    const other = await asUser(db, bob.userId, () => db.query("select id from public.launch_truth_sheets where launch_id = $1", [launchId]));
    expect(other.rows).toHaveLength(0);
    await expect(asUser(db, alice.userId, () => ins(alice.orgId, launchId, 2))).rejects.toThrow();
    await expect(asUser(db, alice.userId, () => db.query("update public.launch_truth_sheets set status='approved' where launch_id=$1", [launchId]))).rejects.toThrow();
  });
});

describe("R4 recordings", () => {
  const rec = (launchId: string, status: string, path: string | null, transcript: string | null, failure: string | null = null) =>
    db.query("insert into public.launch_recordings (organization_id, launch_id, source, status, storage_path, transcript, failure_code) values ($1,$2,'upload',$3,$4,$5,$6) returning id",
      [alice.orgId, launchId, status, path, transcript, failure]);
  it("can't be ready without a stored file and a non-empty transcript", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "rec-ready");
    await expect(rec(launchId, "ready", null, '[{"text":"x"}]')).rejects.toThrow();
    await expect(rec(launchId, "ready", "a/b/c.mp4", "[]")).rejects.toThrow();
    await expect(rec(launchId, "ready", "a/b/c.mp4", null)).rejects.toThrow();
    await rec(launchId, "ready", "a/b/c.mp4", '[{"text":"x"}]');
  });
  it("needs a file for uploaded/transcribing and a code for failed", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "rec-states");
    await expect(rec(launchId, "uploaded", null, null)).rejects.toThrow();
    await expect(rec(launchId, "failed", null, null)).rejects.toThrow();
    await rec(launchId, "failed", null, null, "upload_missing");
    await rec(launchId, "uploading", null, null);
  });
  it("is private to the org and read-only for clients", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "rec-rls");
    await rec(launchId, "uploading", null, null);
    await db.query("insert into public.launch_capture_plans (launch_id, organization_id, rehearsal_checked) values ($1,$2,'{clean_account}')", [launchId, alice.orgId]);
    expect((await asUser(db, alice.userId, () => db.query("select id from public.launch_recordings where launch_id=$1", [launchId]))).rows).toHaveLength(1);
    expect((await asUser(db, bob.userId, () => db.query("select id from public.launch_recordings where launch_id=$1", [launchId]))).rows).toHaveLength(0);
    expect((await asUser(db, bob.userId, () => db.query("select launch_id from public.launch_capture_plans where launch_id=$1", [launchId]))).rows).toHaveLength(0);
    await expect(asUser(db, alice.userId, () => db.query("update public.launch_recordings set status='ready' where launch_id=$1", [launchId]))).rejects.toThrow();
  });
});
