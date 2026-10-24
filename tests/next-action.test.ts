import { describe, expect, it } from "vitest";
import { computeNextAction, noLaunchNextAction } from "@/domain/next-action";
import { LAUNCH_STATUSES, type LaunchStatus } from "@/types/launch";

const facts = (status: LaunchStatus, extra: Partial<Parameters<typeof computeNextAction>[0]> = {}) => ({
  launchId: "L1",
  status,
  appId: "A1",
  scheduledAt: null,
  ctaConfigured: false,
  experimentAwaitingApproval: false,
  ...extra,
});

describe("computeNextAction (§57)", () => {
  it("returns an action for every status", () => {
    for (const s of LAUNCH_STATUSES) {
      const a = computeNextAction(facts(s));
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.launchId).toBe("L1");
    }
  });

  it("sends drafts to intake", () => {
    expect(computeNextAction(facts("DRAFT")).actionType).toBe("COMPLETE_INTAKE");
  });

  it("asks for approval when the strategy is ready", () => {
    const a = computeNextAction(facts("AWAITING_FOUNDER_APPROVAL"));
    expect(a.actionType).toBe("APPROVE_STRATEGY");
    expect(a.blocking).toBe(true);
  });

  it("walks a scheduled launch through time, then CTA, then prep", () => {
    expect(computeNextAction(facts("SCHEDULED")).actionType).toBe("SCHEDULE");
    expect(computeNextAction(facts("SCHEDULED", { scheduledAt: "2026-10-01T17:00:00Z" })).actionType).toBe("CONNECT_CTA");
    expect(
      computeNextAction(facts("SCHEDULED", { scheduledAt: "2026-10-01T17:00:00Z", ctaConfigured: true })).actionType,
    ).toBe("PREPARE_DEMO");
  });

  it("asks for a goal, then payment, after the format is chosen", () => {
    expect(computeNextAction(facts("LAUNCH_TYPE_SELECTED")).actionType).toBe("SET_PRIMARY_GOAL");
    expect(computeNextAction(facts("LAUNCH_TYPE_SELECTED", { primaryGoalSet: true })).actionType).toBe("COMPLETE_PAYMENT");
    expect(computeNextAction(facts("LAUNCH_TYPE_SELECTED", { primaryGoalSet: true, paymentSucceeded: true })).blocking).toBe(false);
  });

  it("sends changes-required launches back to the intake", () => {
    expect(computeNextAction(facts("CHANGES_REQUIRED")).href).toBe("/dashboard/apps/A1/intake");
  });

  it("flags experiments waiting on approval", () => {
    expect(computeNextAction(facts("EXPERIMENTING", { experimentAwaitingApproval: true })).actionType).toBe("APPROVE_EXPERIMENT");
  });

  it("asks for nothing while AppDemo is working", () => {
    for (const s of ["SUBMITTED", "PREPARATION", "CONTENT_GENERATION"] as const) {
      const a = computeNextAction(facts(s));
      expect(a.actionType).toBe("NONE");
      expect(a.blocking).toBe(false);
    }
  });

  it("handles organizations with no launch", () => {
    expect(noLaunchNextAction(false).href).toBe("/dashboard/apps/new");
    expect(noLaunchNextAction(true).href).toBe("/dashboard/launches/new");
  });
});
