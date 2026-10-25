/** PRD v1.4 R9: every launch-scoped v1.4 service refuses other orgs server-side and changes nothing. */
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
let mallory: Account;
const signIn = (a: Account | null) => { current = a ? { id: a.userId, email: a.email, name: a.email } : null; };

const TABLES = ["launch_truth_sheets", "launch_recordings", "launch_clips", "launch_clip_versions", "launch_clip_reviews", "launch_plan_items", "tracked_links", "tracked_link_clicks", "hypotheses", "experiments", "experiment_variants", "experiment_results"];
async function fingerprint() {
  const out: Record<string, string> = {};
  for (const t of TABLES) {
    const r = await pg.query<{ h: string }>(`select coalesce(md5(string_agg(t::text, '|' order by t::text)), '') h from public.${t} t`);
    out[t] = r.rows[0].h;
  }
  return out;
}

let ids: { launchId: string; clipId: string; versionId: string; itemId: string; linkId: string; recordingId: string };
let malloryLaunch: string;

beforeAll(async () => {
  pg = await bootDb();
  setDbForTests(drizzle(pg, { schema }) as unknown as Db);
  alice = { ...(await createUser(pg, "alice-x@example.com", "Alice X")), email: "alice-x@example.com" };
  mallory = { ...(await createUser(pg, "mallory@example.com", "Mallory")), email: "mallory@example.com" };
  const { launchId, appId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "xorg-a");
  await pg.query("update public.apps set website_url = 'https://invoice.example.com/' where id = $1", [appId]);
  const { clipId, versionId } = await seedApprovedClip(pg, alice.orgId, launchId, alice.userId);
  signIn(alice);
  const ts = await import("@/services/truth-sheet");
  await ts.startTruthSheet(launchId);
  const pp = await import("@/services/promotion-plan");
  await pp.generatePromotionPlan(launchId, { channels: [{ channel: "x", owner: "founder" }], startDate: "2026-11-02", timezone: "UTC" });
  const tl = await import("@/services/tracked-links");
  await tl.createLinksForPlan(launchId);
  const m = await tl.getMeasure(launchId);
  const ex = await import("@/services/experiments");
  await ex.startExperiment(launchId, { statement: "Link two will draw more clicks", controlLinkId: m.links[0].id, variantLinkId: m.links[1].id });
  const rec = await pg.query<{ id: string }>("insert into public.launch_recordings (organization_id, launch_id, source) values ($1, $2, 'upload') returning id", [alice.orgId, launchId]);
  const plan = await pp.getPlan(launchId);
  ids = { launchId, clipId, versionId, itemId: plan.items[0].id, linkId: m.links[0].id, recordingId: rec.rows[0].id };
  malloryLaunch = (await seedAppAndLaunch(pg, mallory.orgId, mallory.userId, "xorg-m")).launchId;
});

type Call = [string, (launchId: string) => Promise<unknown>];
async function calls(): Promise<Call[]> {
  const ts = await import("@/services/truth-sheet");
  const rc = await import("@/services/recordings");
  const cp = await import("@/services/content-pack");
  const cpf = await import("@/services/content-pack-files");
  const pp = await import("@/services/promotion-plan");
  const tl = await import("@/services/tracked-links");
  const ex = await import("@/services/experiments");
  const clip = { hook: "Hook", caption: "Caption", cta: "Start", channel: "x" } as never;
  return [
    ["getTruthSheet", (l) => ts.getTruthSheet(l)],
    ["startTruthSheet", (l) => ts.startTruthSheet(l)],
    ["saveTruthSheet", (l) => ts.saveTruthSheet(l, [])],
    ["approveTruthSheet", (l) => ts.approveTruthSheet(l)],
    ["getCapture", (l) => rc.getCapture(l)],
    ["saveCapturePlan", (l) => rc.saveCapturePlan(l, { choice: null, checked: [], confidential: "" })],
    ["beginUpload", (l) => rc.beginUpload(l, { name: "a.mp4", type: "video/mp4", size: 10 }, "upload" as never)],
    ["completeUpload", (l) => rc.completeUpload(l, ids.recordingId)],
    ["transcribeRecording", (l) => rc.transcribeRecording(l, ids.recordingId)],
    ["attachTranscript", (l) => rc.attachTranscript(l, ids.recordingId, "WEBVTT\n\n00:00.000 --> 00:01.000\nhi")],
    ["recordingDownloadUrl", (l) => rc.recordingDownloadUrl(l, ids.recordingId)],
    ["getContentPack", (l) => cp.getContentPack(l)],
    ["proposeContentPack", (l) => cp.proposeContentPack(l)],
    ["addClip", (l) => cp.addClip(l, clip)],
    ["editClip", (l) => cp.editClip(l, ids.clipId, clip)],
    ["dropClip", (l) => cp.dropClip(l, ids.clipId)],
    ["beginExportUpload", (l) => cp.beginExportUpload(l, ids.versionId, { name: "a.mp4", type: "video/mp4", size: 10 })],
    ["completeExportUpload", (l) => cp.completeExportUpload(l, ids.versionId)],
    ["failExport", (l) => cp.failExport(l, ids.versionId, "x")],
    ["reviewClip", (l) => cp.reviewClip(l, ids.versionId, "approved" as never, "")],
    ["getTranscriptVtt", (l) => cpf.getTranscriptVtt(l)],
    ["getPlan", (l) => pp.getPlan(l)],
    ["generatePromotionPlan", (l) => pp.generatePromotionPlan(l, { channels: [{ channel: "x", owner: "founder" }], startDate: "2026-11-02", timezone: "UTC" })],
    ["recordPost", (l) => pp.recordPost(l, ids.itemId, "https://x.com/a/status/1", [])],
    ["confirmPost", (l) => pp.confirmPost(l, ids.itemId)],
    ["skipItem", (l) => pp.skipItem(l, ids.itemId)],
    ["getMeasure", (l) => tl.getMeasure(l)],
    ["createLinksForPlan", (l) => tl.createLinksForPlan(l)],
    ["getImprove", (l) => ex.getImprove(l)],
    ["startExperiment", (l) => ex.startExperiment(l, { statement: "Something testable here", controlLinkId: ids.linkId, variantLinkId: ids.linkId })],
    ["recordResults", (l) => ex.recordResults(l)],
    ["finishExperiment", (l) => ex.recordResults(l, true)],
    ["cancelExperiment", (l) => ex.cancelExperiment(l)],
  ];
}

describe("R9 cross-org sweep", () => {
  it("another org gets NOT_FOUND from every v1.4 call on a foreign launch, and nothing changes", async () => {
    const before = await fingerprint();
    signIn(mallory);
    for (const [name, fn] of await calls()) {
      await expect(fn(ids.launchId).then(() => "resolved", (e) => (e as { code?: string }).code), name).resolves.toBe("NOT_FOUND");
    }
    expect(await fingerprint()).toEqual(before);
  });

  it("signed-out callers are refused everywhere and nothing changes", async () => {
    const before = await fingerprint();
    signIn(null);
    for (const [name, fn] of await calls()) {
      await expect(fn(ids.launchId).then(() => "resolved", () => "rejected"), name).resolves.toBe("rejected");
    }
    expect(await fingerprint()).toEqual(before);
  });

  it("foreign child ids smuggled through the caller's own launch are refused and nothing changes", async () => {
    const before = await fingerprint();
    signIn(mallory);
    const childScoped = new Set(["completeUpload", "transcribeRecording", "attachTranscript", "recordingDownloadUrl", "editClip", "dropClip", "beginExportUpload", "completeExportUpload", "failExport", "reviewClip", "recordPost", "confirmPost", "skipItem", "startExperiment"]);
    for (const [name, fn] of (await calls()).filter(([n]) => childScoped.has(n))) {
      await expect(fn(malloryLaunch).then(() => "resolved", () => "rejected"), name).resolves.toBe("rejected");
    }
    expect(await fingerprint()).toEqual(before);
  });

  it("public tracked-link lookups reveal only the destination", async () => {
    const tl = await import("@/services/tracked-links");
    signIn(null);
    const [link] = (await pg.query<{ slug: string }>("select slug from public.tracked_links where id = $1", [ids.linkId])).rows;
    expect(Object.keys((await tl.resolveLink(link.slug))!).sort()).toEqual(["destination", "id", "launchId"]);
    expect(await tl.resolveLink("nope!")).toBeNull();
  });
});
