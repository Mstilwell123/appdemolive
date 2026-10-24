import { describe, it, expect } from "vitest";
import { orderSummary, participantsSchema, validateSchedule, zonedTimeToUtc, FORMAT_DETAILS } from "@/domain/checkout-preview";

describe("checkout preview", () => {
  it("keeps the $499 and $799 prices in the order summary", () => {
    expect(orderSummary({ launchType: "founder_demo", amount: 49900, currency: "usd", label: "Founder Demo" }).total).toBe(49900);
    expect(orderSummary({ launchType: "cohosted_launch", amount: 79900, currency: "usd", label: "Co-Hosted" }).total).toBe(79900);
    expect(FORMAT_DETAILS.founder_demo.minutes).toBe(15);
    expect(FORMAT_DETAILS.cohosted_launch.minutes).toBe(30);
  });

  it("converts wall time in a time zone to UTC, across DST", () => {
    expect(zonedTimeToUtc("2026-10-15", "10:00", "America/Los_Angeles")!.toISOString()).toBe("2026-10-15T17:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-15", "10:00", "America/Los_Angeles")!.toISOString()).toBe("2026-12-15T18:00:00.000Z");
    expect(zonedTimeToUtc("2026-10-15", "10:00", "Asia/Kolkata")!.toISOString()).toBe("2026-10-15T04:30:00.000Z");
    expect(zonedTimeToUtc("2027-03-14", "02:30", "America/New_York")).toBeNull(); // skipped hour
    expect(zonedTimeToUtc("2026-10-15", "10:00", "Not/AZone")).toBeNull();
  });

  it("rejects past times and invalid zones", () => {
    const now = new Date("2026-09-27T20:00:00Z");
    expect(validateSchedule({ date: "2026-09-27", time: "12:00", timeZone: "America/Los_Angeles" }, now)).toHaveProperty("error");
    expect(validateSchedule({ date: "2026-10-01", time: "12:00", timeZone: "Bogus" }, now)).toHaveProperty("error");
    expect(validateSchedule({ date: "2026-10-01", time: "12:00", timeZone: "America/Los_Angeles" }, now)).toHaveProperty("at");
  });

  it("validates participants", () => {
    expect(participantsSchema.safeParse({ founderName: "A", founderEmail: "a@x.com", guests: [], moderatorNotes: "" }).success).toBe(true);
    expect(participantsSchema.safeParse({ founderName: "", founderEmail: "a@x.com", guests: [] }).success).toBe(false);
    expect(participantsSchema.safeParse({ founderName: "A", founderEmail: "a@x.com", guests: [{ name: "B", email: "A@x.com" }] }).success).toBe(false);
    expect(participantsSchema.safeParse({ founderName: "A", founderEmail: "a@x.com", guests: Array(4).fill(0).map((_, i) => ({ name: "G", email: `g${i}@x.com` })) }).success).toBe(false);
  });

});

describe("formatInZone", () => {
  it("shows the time with its zone label", async () => {
    const { formatInZone } = await import("@/domain/checkout-preview");
    const s = formatInZone(new Date("2026-10-20T17:00:00Z"), "America/Los_Angeles");
    expect(s).toContain("October 20, 2026");
    expect(s).toMatch(/10:00\s?AM PDT/);
  });
});
