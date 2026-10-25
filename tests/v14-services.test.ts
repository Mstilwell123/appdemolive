// PRD v1.4 services run against PGlite with the signed-in user swapped per test.
// There is no row-level security on Neon, so these prove the server-side ownership checks.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { setDbForTests, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/session-user";
import { bootDb, createUser, seedAppAndLaunch } from "./db";

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
