// PRD v1.4 migrations (db/migrations/0002+): reversible, additive, and constrained at the database.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb, createUser, seedAppAndLaunch, seedApprovedClip } from "./db";

let db: PGlite;
let alice: { userId: string; orgId: string };
let bob: { userId: string; orgId: string };

beforeAll(async () => {
  db = await bootDb();
  alice = await createUser(db, "alice-v14@example.com", "Alice v14");
  bob = await createUser(db, "bob-v14@example.com", "Bob v14");
});

const ROLLBACKS = join(__dirname, "..", "db", "rollbacks");
const MIGRATIONS = join(__dirname, "..", "db", "migrations");
const v14 = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f !== "0001_baseline.sql").sort();

describe("v1.4 migrations are additive and reversible", () => {
  it("every v1.4 migration has a rollback, and down then up leaves a working schema", async () => {
    const ups = v14();
    expect(ups.length).toBeGreaterThan(0);
    const fresh = await bootDb();
    for (const up of [...ups].reverse()) await fresh.exec(readFileSync(join(ROLLBACKS, up.replace(/\.sql$/, ".down.sql")), "utf8"));
    for (const up of ups) await fresh.exec(readFileSync(join(MIGRATIONS, up), "utf8"));
    await fresh.close();
  });
  it("v1.4 migrations never drop or rename existing objects", () => {
    for (const f of v14()) {
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
});

describe("R4 recordings", () => {
  const rec = (orgId: string, launchId: string, status: string, path: string | null, transcript: string | null, failure: string | null = null) =>
    db.query("insert into public.launch_recordings (organization_id, launch_id, source, status, storage_path, transcript, failure_code) values ($1,$2,'upload',$3,$4,$5,$6) returning id",
      [orgId, launchId, status, path, transcript, failure]);
  it("can't be ready without a stored file and a non-empty transcript", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "rec-ready");
    await expect(rec(alice.orgId, launchId, "ready", null, '[{"text":"x"}]')).rejects.toThrow();
    await expect(rec(alice.orgId, launchId, "ready", "a/b/c.mp4", "[]")).rejects.toThrow();
    await expect(rec(alice.orgId, launchId, "ready", "a/b/c.mp4", null)).rejects.toThrow();
    await rec(alice.orgId, launchId, "ready", "a/b/c.mp4", '[{"text":"x"}]');
  });
  it("needs a file for uploaded/transcribing and a code for failed", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "rec-states");
    await expect(rec(alice.orgId, launchId, "uploaded", null, null)).rejects.toThrow();
    await expect(rec(alice.orgId, launchId, "failed", null, null)).rejects.toThrow();
    await rec(alice.orgId, launchId, "failed", null, null, "upload_missing");
    await rec(alice.orgId, launchId, "uploading", null, null);
  });
  it("rejects recordings and capture plans tied to another org's launch", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "rec-x");
    await expect(rec(bob.orgId, launchId, "uploading", null, null)).rejects.toThrow();
    await expect(db.query("insert into public.launch_capture_plans (launch_id, organization_id) values ($1,$2)", [launchId, bob.orgId])).rejects.toThrow();
  });
});

describe("R5 content pack", () => {
  const clip = async (orgId: string, launchId: string, pos = 1) =>
    (await db.query<{ id: string }>("insert into public.launch_clips (organization_id, launch_id, position) values ($1,$2,$3) returning id", [orgId, launchId, pos])).rows[0].id;
  const ver = (clipId: string, launchId: string, orgId: string, status = "not_started", path: string | null = null, n = 1) =>
    db.query<{ id: string }>("insert into public.launch_clip_versions (clip_id, launch_id, organization_id, version, content, export_status, export_path) values ($1,$2,$3,$4,'{}'::jsonb,$5,$6) returning id",
      [clipId, launchId, orgId, n, status, path]);
  const review = (versionId: string, launchId: string, orgId: string, decision: string, reason: string | null) =>
    db.query<{ id: string }>("insert into public.launch_clip_reviews (version_id, launch_id, organization_id, stage, decision, reason) values ($1,$2,$3,'internal',$4,$5) returning id",
      [versionId, launchId, orgId, decision, reason]);
  it("a ready export needs a file; versions are unique per clip", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "cp-ready");
    const c = await clip(alice.orgId, launchId);
    await expect(ver(c, launchId, alice.orgId, "ready", null)).rejects.toThrow();
    await ver(c, launchId, alice.orgId, "ready", "a/b/e.mp4");
    await expect(ver(c, launchId, alice.orgId)).rejects.toThrow();
  });
  it("revisions and rejections need a reason, and reviews can't be edited", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "cp-rev");
    const v = (await ver(await clip(alice.orgId, launchId), launchId, alice.orgId)).rows[0].id;
    await expect(review(v, launchId, alice.orgId, "rejected", " ")).rejects.toThrow();
    const r = (await review(v, launchId, alice.orgId, "approved", null)).rows[0].id;
    await expect(db.query("update public.launch_clip_reviews set decision = 'rejected', reason = 'x' where id = $1", [r])).rejects.toThrow(/append-only/);
  });
  it("rejects clips, versions and reviews tied to another org or launch", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "cp-x");
    const { launchId: other } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "cp-x2");
    await expect(clip(bob.orgId, launchId)).rejects.toThrow();
    const c = await clip(alice.orgId, launchId);
    await expect(ver(c, other, alice.orgId)).rejects.toThrow();
    await expect(ver(c, launchId, bob.orgId)).rejects.toThrow();
    const v = (await ver(c, launchId, alice.orgId)).rows[0].id;
    await expect(review(v, other, alice.orgId, "approved", null)).rejects.toThrow();
    await expect(review(v, launchId, bob.orgId, "approved", null)).rejects.toThrow();
  });
});

describe("R6 plan items", () => {
  const item = (orgId: string, launchId: string, versionId: string, status = "planned", posted: string | null = null, by: string | null = null) =>
    db.query("insert into public.launch_plan_items (organization_id, launch_id, clip_version_id, day, planned_date, planned_time, timezone, channel, channel_owner, responsible, audience, objective, post_copy, status, posted_url, posted_at, reported_by) values ($1,$2,$3,1,'2026-11-01','09:00','UTC','x','founder','founder','a','o','c',$4,$5,case when $5::text is null then null else now() end,$6)",
      [orgId, launchId, versionId, status, posted, by]);
  it("a recorded post needs a link and reporter; confirmed needs a confirmer; links are unique per launch", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "pp-db");
    const { versionId } = await seedApprovedClip(db, alice.orgId, launchId, alice.userId);
    await expect(item(alice.orgId, launchId, versionId, "posted_self_reported")).rejects.toThrow();
    await expect(item(alice.orgId, launchId, versionId, "confirmed", "https://a.b/1", alice.userId)).rejects.toThrow();
    await item(alice.orgId, launchId, versionId, "posted_self_reported", "https://a.b/1", alice.userId);
    await expect(item(alice.orgId, launchId, versionId, "posted_self_reported", "https://a.b/1", alice.userId)).rejects.toThrow();
  });
  it("rejects items tied to another org or another launch's clip", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "pp-x");
    const { launchId: other } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "pp-x2");
    const { versionId } = await seedApprovedClip(db, alice.orgId, launchId, alice.userId);
    await expect(item(bob.orgId, launchId, versionId)).rejects.toThrow();
    await expect(item(alice.orgId, other, versionId)).rejects.toThrow();
  });
});

describe("R7 tracked links", () => {
  const link = (orgId: string, launchId: string, slug: string, url = "https://a.example/") =>
    db.query<{ id: string }>("insert into public.tracked_links (organization_id, launch_id, slug, destination_url) values ($1,$2,$3,$4) returning id", [orgId, launchId, slug, url]);
  it("slugs are unique and safe, destinations are http(s), clicks dedupe per visitor window", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "tl-db");
    await expect(link(alice.orgId, launchId, "bad slug!")).rejects.toThrow();
    await expect(link(alice.orgId, launchId, "goodslug1", "javascript:alert(1)")).rejects.toThrow();
    const id = (await link(alice.orgId, launchId, "goodslug1")).rows[0].id;
    await expect(link(alice.orgId, launchId, "goodslug1")).rejects.toThrow();
    const click = () => db.query("insert into public.tracked_link_clicks (link_id, launch_id, visitor_hash, click_window) values ($1,$2,'0123456789abcdef0123',1)", [id, launchId]);
    await click();
    await expect(click()).rejects.toThrow();
  });
  it("rejects links and clicks tied to another org or launch", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "tl-x");
    const { launchId: other } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "tl-x2");
    await expect(link(bob.orgId, launchId, "crossorg1")).rejects.toThrow();
    const id = (await link(alice.orgId, launchId, "ownslug01")).rows[0].id;
    await expect(db.query("insert into public.tracked_link_clicks (link_id, launch_id, visitor_hash, click_window) values ($1,$2,'0123456789abcdef0123',1)", [id, other])).rejects.toThrow();
  });
});
