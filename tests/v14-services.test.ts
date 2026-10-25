// PRD v1.4 services run against PGlite with the signed-in user swapped per test.
// There is no row-level security on Neon, so these prove the server-side ownership checks.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { setDbForTests, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/session-user";
import { bootDb, createUser, seedAppAndLaunch, seedApprovedClip } from "./db";

vi.mock("server-only", () => ({}));
let current: SessionUser | null = null;
vi.mock("@/lib/session-user", () => ({ getSessionUser: async () => current }));

type Account = { userId: string; orgId: string; email: string };
let pg: PGlite;
let alice: Account;
let bob: Account;
let staff: Account;
const signIn = (a: Account | null) => { current = a ? { id: a.userId, email: a.email, name: a.email } : null; };
const NF = { code: "NOT_FOUND" };

beforeAll(async () => {
  pg = await bootDb();
  setDbForTests(drizzle(pg, { schema }) as unknown as Db);
  const mk = async (email: string, org: string) => ({ ...(await createUser(pg, email, org)), email });
  alice = await mk("alice-s@example.com", "Alice S");
  bob = await mk("bob-s@example.com", "Bob S");
  staff = await mk("op-s@pragvance.ai", "Ops");
  await pg.query("insert into public.platform_staff (user_id, role) values ($1, 'operator')", [staff.userId]);
});

describe("R3 truth sheet service", () => {
  it("drafts, versions, approves, and hides everything from other orgs", async () => {
    const ts = await import("@/services/truth-sheet");
    const { launchId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "svc-ts");
    signIn(alice);
    await ts.startTruthSheet(launchId);
    await ts.startTruthSheet(launchId);
    expect((await ts.getTruthSheet(launchId)).current?.version).toBe(1);
    const items = [
      { category: "buyer", kind: "confirmed", statement: "Freelancers" },
      { category: "problem", kind: "confirmed", statement: "Late payments" },
      { category: "product", kind: "confirmed", statement: "Schedules invoices" },
      { category: "benefit", kind: "confirmed", statement: "Paid on time" },
      { category: "pricing", kind: "confirmed", statement: "$19/month", evidenceUrl: "https://example.com/pricing" },
      { category: "free_trial", kind: "confirmed", statement: "No free trial", evidenceUrl: "https://example.com/pricing" },
      { category: "cta", kind: "confirmed", statement: "Start a schedule" },
    ] as never;
    await ts.saveTruthSheet(launchId, items);
    const before = await ts.getTruthSheet(launchId);
    expect(before.current?.version).toBe(2);

    signIn(bob);
    await expect(ts.getTruthSheet(launchId)).rejects.toMatchObject(NF);
    await expect(ts.saveTruthSheet(launchId, items)).rejects.toMatchObject(NF);
    await expect(ts.approveTruthSheet(launchId)).rejects.toMatchObject(NF);

    signIn(staff);
    await expect(ts.approveTruthSheet(launchId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    signIn(alice);
    expect(before.blockers).toEqual([]);
    await ts.approveTruthSheet(launchId);
    expect((await ts.getTruthSheet(launchId)).approved?.version).toBe(2);
    await ts.saveTruthSheet(launchId, items);
    const after = await ts.getTruthSheet(launchId);
    expect(after.current?.status).toBe("draft");
    expect(after.approved?.version).toBe(2);
    signIn(null);
    await expect(ts.getTruthSheet(launchId)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("R4 recording service", () => {
  it("only the launch's org can plan, upload and complete; completion needs the real file", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    process.env.LOCAL_STORAGE_DIR = mkdtempSync(join(tmpdir(), "appdemo-rec-"));
    const storage = await import("@/integrations/storage");
    storage.setStorageForTests(storage.localStorageAdapter);
    const r = await import("@/services/recordings");
    const { launchId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "svc-rec");
    const file = { name: "demo.webm", type: "video/webm", size: 5 };

    signIn(alice);
    await expect(r.beginUpload(launchId, file, "upload")).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await r.saveCapturePlan(launchId, { choice: "upload", checked: ["clean_account", "screen_permission", "bogus"], confidential: "" });
    expect((await r.getCapture(launchId)).plan?.rehearsal_checked).toEqual(["clean_account", "screen_permission"]);

    signIn(bob);
    await expect(r.getCapture(launchId)).rejects.toMatchObject(NF);
    await expect(r.saveCapturePlan(launchId, { choice: null, checked: [], confidential: "" })).rejects.toMatchObject(NF);
    await expect(r.beginUpload(launchId, file, "upload")).rejects.toMatchObject(NF);

    signIn(alice);
    const begun = await r.beginUpload(launchId, file, "upload");
    expect(begun.upload.url).toMatch(/^\/api\/storage\?/);
    signIn(bob);
    await expect(r.completeUpload(launchId, begun.recordingId)).rejects.toMatchObject(NF);
    signIn(alice);
    await expect(r.completeUpload(launchId, begun.recordingId)).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
    expect((await r.getCapture(launchId)).recordings[0].status).toBe("failed");

    const retry = await r.beginUpload(launchId, file, "upload", begun.recordingId);
    const key = new URL(retry.upload.url, "http://x").searchParams.get("key")!;
    expect(key.startsWith(`${alice.orgId}/${launchId}/`)).toBe(true);
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const full = join(storage.storageRoot(), key);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "hello");
    await r.completeUpload(launchId, begun.recordingId);
    expect((await r.getCapture(launchId)).recordings[0]).toMatchObject({ status: "uploaded", attempts: 2 });

    signIn(alice);
    await expect(r.transcribeRecording(launchId, begun.recordingId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await r.attachTranscript(launchId, begun.recordingId, "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello there\n");
    expect((await r.getCapture(launchId)).recordings[0]).toMatchObject({ status: "ready", transcript_source: "manual" });
    expect(await r.recordingDownloadUrl(launchId, begun.recordingId)).toMatch(/op=get/);
    signIn(bob);
    await expect(r.recordingDownloadUrl(launchId, begun.recordingId)).rejects.toMatchObject(NF);

    storage.setStorageForTests(null);
    signIn(alice);
    await expect(r.beginUpload(launchId, file, "upload")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    storage.setStorageForTests(undefined);
  });
});

describe("R5 content pack service", () => {
  it("operator proposes, exports and reviews first; founder approves; other orgs see nothing", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, dirname } = await import("node:path");
    process.env.LOCAL_STORAGE_DIR = mkdtempSync(join(tmpdir(), "appdemo-cp-"));
    const storage = await import("@/integrations/storage");
    storage.setStorageForTests(storage.localStorageAdapter);
    const cp = await import("@/services/content-pack");
    const files = await import("@/services/content-pack-files");
    const { launchId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "svc-cp");
    const transcript = JSON.stringify([
      { startMs: 0, endMs: 6000, text: "The problem is invoicing wastes hours every week." },
      { startMs: 6000, endMs: 12000, text: "Let me show you the dashboard." },
      { startMs: 12000, endMs: 20000, text: "Sign up free at the link below." },
    ]);
    await pg.query("insert into public.launch_recordings (organization_id, launch_id, source, status, storage_path, transcript) values ($1,$2,'upload','ready','x/y/rec.webm',$3::jsonb)",
      [alice.orgId, launchId, transcript]);

    signIn(staff);
    await expect(cp.proposeContentPack(launchId)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await pg.query("insert into public.launch_truth_sheets (organization_id, launch_id, version, status, items, approved_by, approved_at) values ($1,$2,1,'approved','[]'::jsonb,$3,now())",
      [alice.orgId, launchId, alice.userId]);
    signIn(alice);
    await expect(cp.proposeContentPack(launchId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    signIn(staff);
    expect(await cp.proposeContentPack(launchId)).toBeGreaterThan(0);
    await expect(cp.proposeContentPack(launchId)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    signIn(bob);
    await expect(cp.getContentPack(launchId)).rejects.toMatchObject(NF);
    await expect(files.getTranscriptVtt(launchId)).rejects.toMatchObject(NF);
    signIn(alice);
    expect(await files.getTranscriptVtt(launchId)).toMatch(/^WEBVTT/);
    const pack = await cp.getContentPack(launchId);
    const c = pack.clips[0];
    expect(pack.recording?.url).toMatch(/op=get/);

    await expect(cp.reviewClip(launchId, c.current.id, "approved", "")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    signIn(bob);
    await expect(cp.reviewClip(launchId, c.current.id, "approved", "")).rejects.toMatchObject(NF);
    await expect(cp.editClip(launchId, c.id, c.current.content)).rejects.toMatchObject(NF);

    signIn(staff);
    const file = { name: "cut.mp4", type: "video/mp4", size: 5 };
    const begun = await cp.beginExportUpload(launchId, c.current.id, file);
    await expect(cp.completeExportUpload(launchId, c.current.id)).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
    const again = await cp.beginExportUpload(launchId, c.current.id, file);
    expect(again.upload.url).not.toBe(begun.upload.url);
    const key = new URL(again.upload.url, "http://x").searchParams.get("key")!;
    expect(key.startsWith(`${alice.orgId}/${launchId}/exports/`)).toBe(true);
    mkdirSync(dirname(join(storage.storageRoot(), key)), { recursive: true });
    writeFileSync(join(storage.storageRoot(), key), "video");
    await cp.completeExportUpload(launchId, c.current.id);
    await cp.reviewClip(launchId, c.current.id, "approved", "");

    signIn(alice);
    await cp.reviewClip(launchId, c.current.id, "approved", "");
    expect((await cp.getContentPack(launchId)).clips[0].exportUrl).toMatch(/op=get/);
    const { getDb } = await import("@/lib/db");
    expect((await cp.approvedClipVersions(getDb()!, launchId)).map((a) => a.clipId)).toEqual([c.id]);

    // Copy-only edit keeps the export but needs fresh reviews.
    await cp.editClip(launchId, c.id, { ...c.current.content, caption: "New caption", cta: c.current.content.cta || "Start free" });
    const edited = (await cp.getContentPack(launchId)).clips[0];
    expect(edited.current).toMatchObject({ version: 2, export_status: "ready" });
    expect(await cp.approvedClipVersions(getDb()!, launchId)).toEqual([]);
    await expect(cp.reviewClip(launchId, c.current.id, "approved", "")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    storage.setStorageForTests(undefined);
  });
});

describe("R6 promotion plan service", () => {
  it("builds from approved clips, records self-reported posts, team confirms; other orgs see nothing", async () => {
    const pp = await import("@/services/promotion-plan");
    const cp = await import("@/services/content-pack");
    const { launchId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "svc-pp");
    const setup = { channels: [{ channel: "linkedin" as const, owner: "founder" as const }], startDate: "2026-11-02", timezone: "America/Los_Angeles" };
    signIn(alice);
    await expect(pp.generatePromotionPlan(launchId, setup)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const { clipId } = await seedApprovedClip(pg, alice.orgId, launchId, alice.userId);
    await expect(pp.generatePromotionPlan(launchId, { ...setup, timezone: "Mars/Base" })).rejects.toThrow();
    expect(await pp.generatePromotionPlan(launchId, setup)).toBe(8);
    expect(await pp.generatePromotionPlan(launchId, setup)).toBe(8);

    signIn(bob);
    await expect(pp.getPlan(launchId)).rejects.toMatchObject(NF);
    signIn(alice);
    const [first, second] = (await pp.getPlan(launchId)).items;
    expect(first.status).toBe("planned");
    signIn(bob);
    await expect(pp.recordPost(launchId, first.id, "https://linkedin.com/p/1", ["approved", "downloaded", "copy", "account"])).rejects.toMatchObject(NF);

    signIn(alice);
    const all = ["approved", "downloaded", "copy", "account"];
    await expect(pp.recordPost(launchId, first.id, "https://linkedin.com/p/1", ["approved"])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(pp.recordPost(launchId, first.id, "ftp://x", all)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await pp.recordPost(launchId, first.id, "https://linkedin.com/p/1", all);
    await expect(pp.recordPost(launchId, first.id, "https://linkedin.com/p/2", all)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(pp.recordPost(launchId, second.id, "https://linkedin.com/p/1", all)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(pp.confirmPost(launchId, first.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(pp.generatePromotionPlan(launchId, setup)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    signIn(staff);
    await pp.confirmPost(launchId, first.id);

    // Editing the clip puts unrecorded items on hold until the new version is approved.
    signIn(alice);
    const cur = (await cp.getContentPack(launchId)).clips.find((c) => c.id === clipId)!;
    await cp.editClip(launchId, clipId, { ...cur.current.content, caption: "Changed" });
    const after = (await pp.getPlan(launchId)).items.find((i) => i.id === second.id)!;
    expect(after.blocker).toMatch(/on hold/);
    await expect(pp.recordPost(launchId, second.id, "https://linkedin.com/p/3", all)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await pp.skipItem(launchId, second.id);
  });
});

describe("R7 tracked links", () => {
  it("creates links per plan item, dedupes clicks, redirects even when tracking fails; other orgs see nothing", async () => {
    const pp = await import("@/services/promotion-plan");
    const tl = await import("@/services/tracked-links");
    const { GET } = await import("@/app/r/[slug]/route");
    const { NextRequest } = await import("next/server");
    const { launchId, appId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "svc-tl");
    await pg.query("update public.apps set website_url = 'https://invoice.example.com/' where id = $1", [appId]);
    await seedApprovedClip(pg, alice.orgId, launchId, alice.userId);
    signIn(alice);
    expect((await tl.getMeasure(launchId)).metrics.every((m) => m.status === "unavailable")).toBe(true);
    await pp.generatePromotionPlan(launchId, { channels: [{ channel: "x", owner: "founder" }], startDate: "2026-11-02", timezone: "UTC" });
    expect(await tl.createLinksForPlan(launchId)).toBe(8);
    expect(await tl.createLinksForPlan(launchId)).toBe(0);
    signIn(bob);
    await expect(tl.getMeasure(launchId)).rejects.toMatchObject(NF);
    await expect(tl.createLinksForPlan(launchId)).rejects.toMatchObject(NF);
    signIn(alice);
    const link = (await tl.getMeasure(launchId)).links[0];

    const hit = (cookie?: string) => GET(new NextRequest(`http://localhost/r/${link.slug}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ slug: link.slug }) });
    const r1 = await hit();
    expect(r1.status).toBe(302);
    expect(r1.headers.get("location")).toContain("invoice.example.com");
    const visitor = r1.headers.get("set-cookie")!.match(/ad_v=([^;]+)/)![1];
    await hit(`ad_v=${visitor}`);
    await hit();
    const m = await tl.getMeasure(launchId);
    expect(m.links.find((l) => l.slug === link.slug)!.clicks).toBe(2);
    expect(m.metrics.find((x) => x.source === "clicks")).toMatchObject({ status: "connected", value: 2 });
    expect(m.metrics.find((x) => x.source === "signups")).toMatchObject({ status: "unavailable", value: null });

    // Tracking failure (clicks table gone) still redirects.
    await pg.exec("alter table public.tracked_link_clicks rename to tracked_link_clicks_off");
    try {
      const r = await hit();
      expect(r.status).toBe(302);
    } finally { await pg.exec("alter table public.tracked_link_clicks_off rename to tracked_link_clicks"); }
    expect((await GET(new NextRequest("http://localhost/r/nope-nope-nope"), { params: Promise.resolve({ slug: "nope-nope-nope" }) })).status).toBe(404);
  });
});
