import { describe, expect, it } from "vitest";
import { TARGET_CLIPS, founderApprovalBlockers, proposeClips, revisionsUsed, toVtt, versionState, type ClipContent } from "@/domain/content-pack";
import type { TruthItem } from "@/domain/truth-sheet";

const seg = (s: number, text: string) => ({ startMs: s * 1000, endMs: s * 1000 + 6000, text });
const transcript = [
  seg(0, "Hi, I'm Sam."), seg(6, "The problem is invoicing wastes hours every week."), seg(12, "So we built this."),
  seg(20, "Let me show you the dashboard."), seg(26, "You click here to create an invoice."), seg(40, "For example, a customer of ours runs a bakery."),
  seg(60, "A common question is does it work with Stripe?"), seg(70, "Yes, it integrates in two minutes."), seg(90, "Sign up free at the link below."),
];
const content = (over: Partial<ClipContent> = {}): ClipContent => ({ viewer: "v", purpose: "p", why: "", hook: "h", startMs: 0, endMs: 9000, onScreen: "", caption: "Try it", claims: [], cta: "Sign up", placement: "feed_post", aspect: "1:1", ...over });

describe("clip proposals", () => {
  it("picks distinct, explained moments without padding to the target", () => {
    const clips = proposeClips(transcript, { audience: "Freelancers", cta: "Start free" });
    expect(clips.length).toBeGreaterThan(2);
    expect(clips.length).toBeLessThanOrEqual(TARGET_CLIPS);
    for (const c of clips) { expect(c.why).not.toBe(""); expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(8000); expect(c.viewer).toBe("Freelancers"); }
    for (let i = 1; i < clips.length; i++) expect(clips[i].startMs).toBeGreaterThanOrEqual(clips[i - 1].endMs);
    expect(proposeClips([seg(0, "Hello there."), seg(6, "Nice weather.")], { audience: "", cta: "" })).toEqual([]);
    expect(proposeClips([], { audience: "", cta: "" })).toEqual([]);
  });
});

describe("versioned approvals", () => {
  const v1 = { id: "v1", export_status: "ready" as const }, v2 = { id: "v2", export_status: "ready" as const };
  const reviews = [{ version_id: "v1", stage: "internal" as const, decision: "approved" as const }, { version_id: "v1", stage: "founder" as const, decision: "approved" as const }];
  it("approval belongs to one version, so a new version starts unapproved", () => {
    expect(versionState(v1, reviews).approved).toBe(true);
    expect(versionState(v2, reviews)).toMatchObject({ approved: false, label: "In team review" });
  });
  it("needs both stages, and the latest decision per stage wins", () => {
    expect(versionState(v1, reviews.slice(0, 1)).label).toBe("Waiting for your approval");
    expect(versionState(v1, [...reviews, { version_id: "v1", stage: "founder", decision: "revision_requested" }]).approved).toBe(false);
  });
  it("blocks founder approval before team review, without an export, or with unevidenced claims", () => {
    const truth: TruthItem[] = [{ category: "pricing", kind: "founder_reported", statement: "$9/mo", evidenceUrl: "https://x.co/pricing", evidenceNote: null }];
    expect(founderApprovalBlockers(v1, "approved", content(), truth)).toEqual([]);
    expect(founderApprovalBlockers(v1, null, content(), truth)).toHaveLength(1);
    expect(founderApprovalBlockers({ id: "x", export_status: "failed" }, "approved", content(), truth)).toHaveLength(1);
    expect(founderApprovalBlockers(v1, "approved", content(), null)).toHaveLength(1);
    expect(founderApprovalBlockers(v1, "approved", content({ caption: "Money-back guarantee!" }), truth).join()).toMatch(/guarantee/);
    expect(founderApprovalBlockers(v1, "approved", content({ caption: "Only $9 per month" }), truth)).toEqual([]);
  });
  it("counts founder revision rounds", () => {
    expect(revisionsUsed([{ version_id: "a", stage: "founder", decision: "revision_requested" }, { version_id: "a", stage: "internal", decision: "revision_requested" }])).toBe(1);
  });
  it("writes valid WebVTT", () => {
    expect(toVtt([{ startMs: 61_500, endMs: 3_725_000, text: " Hi " }])).toBe("WEBVTT\n\n1\n00:01:01.500 --> 01:02:05.000\nHi\n");
  });
});
