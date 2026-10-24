import { describe, expect, it, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootDb } from "./db";
import { LAUNCH_TRANSITIONS, canTransition } from "@/domain/launch-state-machine";
import { LAUNCH_STATUSES } from "@/types/launch";

let db: PGlite;
beforeAll(async () => {
  db = await bootDb();
});

describe("state machine parity (TypeScript vs SQL)", () => {
  it("has identical statuses", async () => {
    const r = await db.query<{ status: string }>("select status from public.launch_statuses order by status");
    expect(r.rows.map((x) => x.status).sort()).toEqual([...LAUNCH_STATUSES].sort());
  });

  it("has identical transitions and actors", async () => {
    const r = await db.query<{ from_status: string; to_status: string; allowed_actors: string[] }>(
      "select from_status, to_status, allowed_actors from public.launch_status_transitions",
    );
    const sql = new Map(r.rows.map((x) => [`${x.from_status}>${x.to_status}`, [...x.allowed_actors].sort()]));
    const ts = new Map([...LAUNCH_TRANSITIONS].map(([k, v]) => [k, [...v].sort()]));
    expect(Object.fromEntries(sql)).toEqual(Object.fromEntries(ts));
  });
});

describe("canTransition", () => {
  const ctx = { launchType: null, scheduledAt: null, primaryGoalCount: 0 };

  it("rejects a skipped step", () => {
    const r = canTransition("DRAFT", "LIVE", "operator", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("allows a founder to submit intake", () => {
    expect(canTransition("INTAKE_IN_PROGRESS", "SUBMITTED", "founder", ctx).ok).toBe(true);
  });

  it("stops a founder from qualifying their own app", () => {
    const r = canTransition("QUALIFICATION_REVIEW", "QUALIFIED", "founder", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("requires a launch type before LAUNCH_TYPE_SELECTED", () => {
    expect(canTransition("QUALIFIED", "LAUNCH_TYPE_SELECTED", "founder", ctx).ok).toBe(false);
    expect(canTransition("QUALIFIED", "LAUNCH_TYPE_SELECTED", "founder", { ...ctx, launchType: "founder_demo" }).ok).toBe(true);
  });

  it("requires payment before preparation (C2)", () => {
    const c = { ...ctx, launchType: "founder_demo" as const };
    const r = canTransition("LAUNCH_TYPE_SELECTED", "PREPARATION", "system", c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PAYMENT_REQUIRED");
    expect(canTransition("LAUNCH_TYPE_SELECTED", "PREPARATION", "system", { ...c, paymentSucceeded: true }).ok).toBe(true);
  });

  it("requires one primary goal and a time before READY", () => {
    expect(canTransition("SCHEDULED", "READY", "operator", ctx).ok).toBe(false);
    expect(
      canTransition("SCHEDULED", "READY", "operator", { ...ctx, primaryGoalCount: 1, scheduledAt: "2026-10-01T17:00:00Z" }).ok,
    ).toBe(true);
  });

  it("only resumes a paused launch to where it was, by an operator", () => {
    expect(canTransition("PAUSED", "PREPARATION", "operator", { ...ctx, resumeTo: "PREPARATION" }).ok).toBe(true);
    expect(canTransition("PAUSED", "LIVE", "operator", { ...ctx, resumeTo: "PREPARATION" }).ok).toBe(false);
    expect(canTransition("PAUSED", "PREPARATION", "founder", { ...ctx, resumeTo: "PREPARATION" }).ok).toBe(false);
  });

  it("never leaves a terminal state", () => {
    for (const to of LAUNCH_STATUSES) {
      expect(canTransition("COMPLETED", to, "operator", ctx).ok).toBe(false);
      expect(canTransition("CANCELLED", to, "operator", ctx).ok).toBe(false);
    }
  });
});
