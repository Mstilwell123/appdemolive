import { describe, expect, it } from "vitest";
import { decisionProblem } from "@/domain/qualification";
import { intakeDraftSchema, missingIntakeFields, newAppSchema, slugify } from "@/schemas/app";
import { goalSchema, launchDetailsSchema } from "@/schemas/launch";

const allPass = { functionality: "pass", security: "pass", privacy: "pass", fraud: "n_a", brand_ip: "pass", launch_readiness: "pass" } as const;

describe("qualification decisions", () => {
  it("allows qualifying only when every area passes or is not applicable", () => {
    expect(decisionProblem(allPass, "qualified", null)).toBeNull();
    expect(decisionProblem({ ...allPass, security: "pending" }, "qualified", null)).toMatch(/Every area/);
    expect(decisionProblem({ ...allPass, privacy: "fail" }, "qualified", null)).toMatch(/Every area/);
  });
  it("requires notes to ask for changes or reject", () => {
    expect(decisionProblem(allPass, "changes_required", " ")).toMatch(/Explain/);
    expect(decisionProblem(allPass, "rejected", "Impersonates another brand")).toBeNull();
  });
});

describe("intake validation (§8)", () => {
  it("lists every missing minimum field", () => {
    const d = intakeDraftSchema.parse({ founderName: "Ann", companyName: "", targetCustomer: "Agencies" });
    expect(missingIntakeFields(d)).toEqual(["Company name", "Short description", "Problem solved", "Desired outcome", "Desired customer action"]);
  });
  it("rejects a bad website and requires the basics for a new app", () => {
    const r = newAppSchema.safeParse({ name: "", websiteUrl: "not a url", category: "SaaS", description: "x", founderName: "A", companyName: "B" });
    expect(r.success).toBe(false);
    expect(newAppSchema.safeParse({ name: "Scorer", websiteUrl: "", category: "SaaS", description: "Scores", founderName: "A", companyName: "B" }).success).toBe(true);
  });
  it("makes safe slugs", () => {
    expect(slugify("  Lead Scorer Pro!! ")).toBe("lead-scorer-pro");
    expect(slugify("🚀")).toBe("app");
  });
});

describe("launch validation (§6, §56)", () => {
  it("normalizes the DM keyword and rejects bad ones", () => {
    const ok = launchDetailsSchema.parse({ objective: "", audience: "", ctaText: "", dmKeyword: "score", trackedDestinationUrl: "" });
    expect(ok.dmKeyword).toBe("SCORE");
    expect(launchDetailsSchema.safeParse({ objective: "", audience: "", ctaText: "", dmKeyword: "no spaces", trackedDestinationUrl: "" }).success).toBe(false);
  });
  it("validates goals", () => {
    expect(goalSchema.safeParse({ goalType: "signup", targetValue: "50", destinationUrl: "" }).success).toBe(true);
    expect(goalSchema.safeParse({ goalType: "vibes", targetValue: "", destinationUrl: "" }).success).toBe(false);
    expect(goalSchema.safeParse({ goalType: "signup", targetValue: "-1", destinationUrl: "" }).success).toBe(false);
  });
});
