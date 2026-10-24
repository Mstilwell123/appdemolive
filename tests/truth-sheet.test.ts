import { describe, expect, it } from "vitest";
import { approvalBlockers, draftTruthSheet, unsupportedClaims, unsupportedClaimsInCopy, type TruthItem } from "@/domain/truth-sheet";

const intake = {
  appName: "InvoicePilot", websiteUrl: null, founderDescription: "Sends invoices on schedule.", targetCustomer: "Freelancers",
  problemSolved: "Chasing late payments", desiredOutcome: "Get paid on time", pricingSummary: "$19/month, 14-day free trial", primaryCta: "Create your first schedule",
};

describe("truth sheet draft", () => {
  it("marks intake as founder-reported and AI output as suggestions or missing, never confirmed", () => {
    const items = draftTruthSheet(intake, { differentiators: ["Reads proposals"], claimsRequiringVerification: ["Cuts late payments 40%"], missingInformation: ["Refund policy"] });
    expect(items.some((i) => i.kind === "confirmed")).toBe(false);
    expect(items.find((i) => i.category === "buyer")?.kind).toBe("founder_reported");
    expect(items.find((i) => i.statement === "Reads proposals")?.kind).toBe("suggestion");
    expect(items.find((i) => i.statement === "Refund policy")?.kind).toBe("missing");
    expect(items.some((i) => i.category === "free_trial")).toBe(true);
  });
  it("records missing required facts instead of inventing them", () => {
    const items = draftTruthSheet({ ...intake, targetCustomer: null, pricingSummary: "" }, null);
    expect(items.find((i) => i.category === "buyer")?.kind).toBe("missing");
    expect(items.find((i) => i.category === "pricing")?.kind).toBe("missing");
  });
});

describe("approval rules", () => {
  it("blocks approval while pricing and a trial lack evidence, and allows it once evidence is added", () => {
    const items = draftTruthSheet(intake, null);
    const blockers = approvalBlockers(items);
    expect(blockers.some((b) => b.includes("pricing"))).toBe(true);
    expect(blockers.some((b) => b.includes("free trial"))).toBe(true);
    const fixed = items.map((i) => (i.category === "pricing" || i.category === "free_trial" ? { ...i, evidenceUrl: "https://invoicepilot.example/pricing" } : i));
    expect(approvalBlockers(fixed)).toEqual([]);
  });
  it("does not require evidence for claims marked missing or suggestions", () => {
    const items: TruthItem[] = [{ category: "guarantee", kind: "suggestion", statement: "Maybe offer a guarantee" }];
    expect(unsupportedClaims(items)).toEqual([]);
  });
});

describe("promotional copy check", () => {
  const sheet: TruthItem[] = [
    { category: "pricing", kind: "confirmed", statement: "$19 a month", evidenceUrl: "https://x.example/pricing" },
    { category: "free_trial", kind: "founder_reported", statement: "14-day free trial" },
  ];
  it("flags an unsupported free trial, guarantee and performance claim", () => {
    expect(unsupportedClaimsInCopy("Start your free trial today", sheet)).toEqual(["free_trial"]);
    expect(unsupportedClaimsInCopy("Money-back guarantee", sheet)).toEqual(["guarantee"]);
    expect(unsupportedClaimsInCopy("Get paid 3x faster", sheet)).toContain("performance_claim");
  });
  it("allows supported pricing and plain copy", () => {
    expect(unsupportedClaimsInCopy("It's $19 a month.", sheet)).toEqual([]);
    expect(unsupportedClaimsInCopy("Create your first invoice schedule", sheet)).toEqual([]);
  });
});
