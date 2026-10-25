import { describe, expect, it } from "vitest";
import { tabKeyTarget } from "@/lib/tabs";
import { EXAMPLE_STAGES, stageHash, stageIndexFromHash } from "@/lib/example-stages";
import campaign from "@/content/example-campaign.json";
import samples from "@/content/demo-samples.json";
import { existsSync } from "node:fs";

describe("stage navigator keyboard model", () => {
  it("moves with arrows and wraps", () => {
    expect(tabKeyTarget(0, "ArrowRight", 6)).toBe(1);
    expect(tabKeyTarget(5, "ArrowRight", 6)).toBe(0);
    expect(tabKeyTarget(0, "ArrowLeft", 6)).toBe(5);
    expect(tabKeyTarget(2, "ArrowDown", 6)).toBe(3);
    expect(tabKeyTarget(2, "ArrowUp", 6)).toBe(1);
  });
  it("supports Home/End and ignores other keys", () => {
    expect(tabKeyTarget(3, "Home", 6)).toBe(0);
    expect(tabKeyTarget(1, "End", 6)).toBe(5);
    expect(tabKeyTarget(1, "Enter", 6)).toBeNull();
    expect(tabKeyTarget(0, "ArrowRight", 0)).toBeNull();
  });
});

describe("six stages and hash restore", () => {
  it("has the PRD's six stages in order", () => {
    expect(EXAMPLE_STAGES.map((s) => s.label)).toEqual(["Understand", "Demonstrate", "Create", "Promote", "Measure", "Improve"]);
  });
  it("round-trips the hash and rejects unknown values", () => {
    EXAMPLE_STAGES.forEach((s, i) => expect(stageIndexFromHash(stageHash(s.id))).toBe(i));
    expect(stageIndexFromHash("#stage-nope")).toBeNull();
    expect(stageIndexFromHash("")).toBeNull();
  });
});

describe("example campaign content is complete and honest", () => {
  it("ships every media file it references", () => {
    for (const f of ["source-demo.mp4", "source-demo.vtt", "poster.jpg", "invoicepilot-example-pack.zip"]) expect(existsSync(`public/example/${f}`)).toBe(true);
    for (const c of campaign.clips) {
      expect(existsSync(`public/example/clip-${c.id}.mp4`)).toBe(true);
      expect(existsSync(`public/example/clip-${c.id}.vtt`)).toBe(true);
    }
    expect(campaign.clips.length).toBe(8);
  });
  it("has a 14-day plan, labeled example results and one experiment", () => {
    expect(campaign.plan.map((d) => d.day)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(campaign.results.label).toBe("Example data");
    expect(campaign.experiment.hypothesis.length).toBeGreaterThan(10);
  });
  it("InvoicePilot never claims a free trial (R2)", () => {
    const ip = samples.samples.find((s) => s.id === "invoicepilot")!;
    const text = JSON.stringify({ ...ip, analysis: { ...ip.analysis, missingInformation: [] }, corrections: [] }) + JSON.stringify(campaign);
    expect(text.toLowerCase()).not.toContain("free trial");
  });
});
