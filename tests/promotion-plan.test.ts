import { describe, expect, it } from "vitest";
import { POST_DAYS, STATUS_LABELS, generatePlan, postingBlocker, taggedDestination, validPostUrl } from "@/domain/promotion-plan";
import type { ClipContent } from "@/domain/content-pack";

const content = (placement: ClipContent["placement"]): ClipContent => ({ viewer: "Freelancers", purpose: "Show the dashboard", why: "", hook: "Hook", startMs: 0, endMs: 9000, onScreen: "", caption: "Caption", claims: [], cta: "Start free", placement, aspect: "9:16" });

describe("promotion plan", () => {
  it("never labels anything published or scheduled", () => {
    expect(Object.values(STATUS_LABELS).join(" ")).not.toMatch(/publish|schedul/i);
    expect(STATUS_LABELS.planned).toBe("Ready to Post");
  });
  it("spreads clips over 14 days on suitable channels", () => {
    const plan = generatePlan([{ versionId: "v1", position: 1, version: 1, content: content("feed_post") }],
      [{ channel: "linkedin", owner: "founder" }, { channel: "tiktok", owner: "appdemo" }], "2026-11-01", "https://example.com/");
    expect(plan.map((p) => p.day)).toEqual([...POST_DAYS]);
    expect(plan.every((p) => p.channel === "linkedin")).toBe(true);
    expect(plan[0].plannedDate).toBe("2026-11-01");
    expect(plan.at(-1)!.plannedDate).toBe("2026-11-13");
    expect(plan[0].destinationUrl).toContain("utm_source=linkedin");
  });
  it("returns nothing without clips or channels and rejects bad URLs", () => {
    expect(generatePlan([], [{ channel: "x", owner: "founder" }], "2026-11-01", null)).toEqual([]);
    expect(taggedDestination("not a url", "x", { versionId: "v", position: 1, version: 1, content: content("email") })).toBeNull();
    expect(validPostUrl("javascript:alert(1)")).toBe(false);
    expect(postingBlocker({ status: "planned" }, false)).toMatch(/on hold/);
    expect(postingBlocker({ status: "planned" }, true)).toBeNull();
  });
});
