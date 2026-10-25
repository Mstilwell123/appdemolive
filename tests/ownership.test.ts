// Org ownership is enforced in the services (there is no row-level security on Neon).
// These run the real services against PGlite with the signed-in user swapped per test.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { setDbForTests, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/session-user";
import { bootDb, createUser, seedAppAndLaunch, walk } from "./db";

vi.mock("server-only", () => ({}));
let current: SessionUser | null = null;
vi.mock("@/lib/session-user", () => ({ getSessionUser: async () => current }));

let pg: PGlite;
type Account = { userId: string; orgId: string; email: string };
let alice: Account;
let bob: Account;
let staff: Account;
const signIn = (a: Account | null) => {
  current = a ? { id: a.userId, email: a.email, name: a.email } : null;
};

const intake = { founderName: "A", companyName: "Alice Co", founderDescription: "d", targetCustomer: null, problemSolved: null, desiredOutcome: null, desiredAction: null };

beforeAll(async () => {
  pg = await bootDb();
  setDbForTests(drizzle(pg, { schema }) as unknown as Db);
  const mk = async (email: string, org: string) => ({ ...(await createUser(pg, email, org)), email });
  alice = await mk("alice@example.com", "Alice Co");
  bob = await mk("bob@example.com", "Bob Co");
  staff = await mk("op@pragvance.ai", "Pragvance");
  await pg.query("insert into public.platform_staff (user_id, role) values ($1, 'operator')", [staff.userId]);
});

describe("session guards", () => {
  it("rejects signed-out callers", async () => {
    const { requireUser } = await import("@/services/session");
    signIn(null);
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("hides the operator role from founders and allows staff", async () => {
    const { requireOperator, operatorAccess } = await import("@/services/session");
    signIn(alice);
    await expect(requireOperator()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await operatorAccess()).toBe("denied");
    signIn(staff);
    await expect(requireOperator()).resolves.toMatchObject({ user: { id: staff.userId } });
    expect(await operatorAccess()).toBe("ok");
    signIn(null);
    expect(await operatorAccess()).toBe("signed_out");
  });

  it("authorizeOrg admits members only", async () => {
    const { authorizeOrg } = await import("@/services/session");
    signIn(alice);
    await expect(authorizeOrg(alice.orgId)).resolves.toMatchObject({ role: "owner" });
    await expect(authorizeOrg(bob.orgId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeOrg(alice.orgId, ["admin"])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("authorizeLaunch admits the owning org and staff, nobody else", async () => {
    const { authorizeLaunch } = await import("@/services/session");
    const { launchId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "authz-app");
    signIn(alice);
    await expect(authorizeLaunch(launchId)).resolves.toMatchObject({ actorKind: "founder" });
    signIn(staff);
    await expect(authorizeLaunch(launchId)).resolves.toMatchObject({ actorKind: "operator" });
    await expect(authorizeLaunch(launchId, ["founder"])).rejects.toMatchObject({ code: "NOT_FOUND" });
    signIn(bob);
    await expect(authorizeLaunch(launchId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("founder services stay inside their organization", () => {
  it("creates apps only in the caller's org and lists only their own", async () => {
    const apps = await import("@/services/apps");
    signIn(alice);
    const appId = await apps.createApp({ name: "Alice Svc", websiteUrl: null, description: "d", category: "SaaS", businessType: null, founderName: "A", companyName: "Alice Co" });
    const r = await pg.query<{ organization_id: string; created_by: string }>("select organization_id, created_by from public.apps where id = $1", [appId]);
    expect(r.rows[0]).toEqual({ organization_id: alice.orgId, created_by: alice.userId });
    expect((await apps.listApps()).map((a) => a.id)).toContain(appId);
    signIn(bob);
    expect((await apps.listApps()).map((a) => a.id)).not.toContain(appId);
    await expect(apps.getAppDetail(appId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(apps.saveIntake(appId, intake, { productUrl: null, privacyUrl: null, termsUrl: null, pricingUrl: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(apps.createNextVersion(appId)).rejects.toBeTruthy();
  });

  it("locks a submitted intake from edits", async () => {
    const apps = await import("@/services/apps");
    signIn(alice);
    const appId = await apps.createApp({ name: "Locked Intake", websiteUrl: null, description: "d", category: "SaaS", businessType: null, founderName: "A", companyName: "Alice Co" });
    await pg.query("update public.app_intakes set status = 'submitted', submitted_at = now() where app_id = $1", [appId]);
    await expect(apps.saveIntake(appId, intake, { productUrl: null, privacyUrl: null, termsUrl: null, pricingUrl: null })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("hides another org's launch and blocks edits, goals and status changes", async () => {
    const setup = await import("@/services/launch-setup");
    const { transitionLaunch } = await import("@/services/launches");
    const { launchId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "cross-launch-app");
    signIn(bob);
    expect((await setup.listLaunches()).map((l) => l.id)).not.toContain(launchId);
    await expect(setup.getLaunchDetail(launchId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      setup.updateLaunchDetails(launchId, { objective: "x", audience: null, ctaText: null, dmKeyword: null, trackedDestinationUrl: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setup.addGoal(launchId, { goalType: "signup", targetValue: null, destinationUrl: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(transitionLaunch({ launchId, to: "INTAKE_IN_PROGRESS", actorKind: "founder" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(transitionLaunch({ launchId, to: "INTAKE_IN_PROGRESS", actorKind: "operator" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const r = await pg.query<{ status: string; objective: string | null }>("select status, objective from public.launches where id = $1", [launchId]);
    expect(r.rows[0]).toEqual({ status: "DRAFT", objective: null });
  });

  it("lets the owner edit descriptive fields only; price comes from the format snapshot", async () => {
    const setup = await import("@/services/launch-setup");
    const { launchId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "price-svc-app");
    await walk(pg, launchId, [
      ["DRAFT", "INTAKE_IN_PROGRESS", "founder"],
      ["INTAKE_IN_PROGRESS", "SUBMITTED", "founder"],
      ["SUBMITTED", "QUALIFICATION_REVIEW", "system"],
      ["QUALIFICATION_REVIEW", "QUALIFIED", "operator"],
    ]);
    signIn(alice);
    const forged = { objective: "Grow", audience: null, ctaText: null, dmKeyword: null, trackedDestinationUrl: null, price_amount: 1, status: "LIVE" };
    await setup.updateLaunchDetails(launchId, forged);
    await setup.chooseLaunchType(launchId, "cohosted_launch");
    const r = await pg.query<{ objective: string; price_amount: number; status: string }>("select objective, price_amount, status from public.launches where id = $1", [launchId]);
    expect(r.rows[0]).toEqual({ objective: "Grow", price_amount: 79900, status: "LAUNCH_TYPE_SELECTED" });
  });

  it("keeps one primary goal and refuses goal changes once the launch is READY", async () => {
    const setup = await import("@/services/launch-setup");
    const { launchId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "goal-svc-app");
    signIn(alice);
    await setup.addGoal(launchId, { goalType: "signup", targetValue: null, destinationUrl: null });
    await setup.addGoal(launchId, { goalType: "trial", targetValue: 40, destinationUrl: null });
    const goals = await pg.query<{ id: string; goal_type: string; is_primary: boolean }>("select id, goal_type, is_primary from public.launch_goals where launch_id = $1 order by created_at", [launchId]);
    await setup.setPrimaryGoal(goals.rows[1].id);
    const p = await pg.query<{ goal_type: string }>("select goal_type from public.launch_goals where launch_id = $1 and is_primary", [launchId]);
    expect(p.rows).toEqual([{ goal_type: "trial" }]);
    signIn(bob);
    await expect(setup.setPrimaryGoal(goals.rows[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setup.removeGoal(goals.rows[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await pg.query("update public.launches set status = 'READY' where id = $1", [launchId]);
    signIn(alice);
    await expect(setup.addGoal(launchId, { goalType: "purchase", targetValue: null, destinationUrl: null })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("operator services require platform staff", () => {
  it("keeps founders out of the qualification queue and decisions", async () => {
    const qual = await import("@/services/qualification");
    const { versionId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "op-guard-app");
    const q = await pg.query<{ id: string }>("insert into public.qualifications (organization_id, app_version_id) values ($1, $2) returning id", [alice.orgId, versionId]);
    signIn(alice);
    await expect(qual.listQualificationQueue()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(qual.decideQualification(q.rows[0].id, "qualified", null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(qual.reviewArea(q.rows[0].id, "security", "pass", null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    signIn(staff);
    await expect(qual.listQualificationQueue()).resolves.toBeDefined();
  });
});
