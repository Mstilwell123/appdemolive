import { describe, expect, it, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, bootDb, createUser, seedAppAndLaunch, walk } from "./db";

let db: PGlite;
let alice: { userId: string; orgId: string };
let bob: { userId: string; orgId: string };
let staffId: string;

beforeAll(async () => {
  db = await bootDb();
  alice = await createUser(db, "alice@example.com", "Alice Co");
  bob = await createUser(db, "bob@example.com", "Bob Co");
  staffId = (await createUser(db, "op@pragvance.ai", "Pragvance")).userId;
  await db.query("insert into public.platform_staff (user_id, role) values ($1, 'operator')", [staffId]);
});

const toQualified: Array<[string, string, string]> = [
  ["DRAFT", "INTAKE_IN_PROGRESS", "founder"],
  ["INTAKE_IN_PROGRESS", "SUBMITTED", "founder"],
  ["SUBMITTED", "QUALIFICATION_REVIEW", "system"],
  ["QUALIFICATION_REVIEW", "QUALIFIED", "operator"],
];

describe("price snapshot (§54)", () => {
  it("copies the configured price when the founder picks a format, and ignores client-sent prices", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "price-app");
    await walk(db, launchId, toQualified);
    await asUser(db, alice.userId, () => db.query("update public.launches set launch_type = 'cohosted_launch' where id = $1", [launchId]));
    const r = await db.query<{ price_amount: number; currency: string }>("select price_amount, currency from public.launches where id = $1", [launchId]);
    expect(r.rows[0]).toEqual({ price_amount: 79900, currency: "usd" });
    await expect(
      asUser(db, alice.userId, () => db.query("update public.launches set price_amount = 1 where id = $1", [launchId])),
    ).rejects.toThrow();
  });

  it("locks the format once preparation starts", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "lock-app");
    await walk(db, launchId, toQualified);
    await db.query("update public.launches set launch_type = 'founder_demo' where id = $1", [launchId]);
    await walk(db, launchId, [["QUALIFIED", "LAUNCH_TYPE_SELECTED", "founder"]]);
    await db.query(
      "insert into public.launch_payments (organization_id, launch_id, provider, provider_payment_id, amount, currency, status) values ($1, $2, 'stripe', 'pi_test_lock', 49900, 'usd', 'succeeded')",
      [alice.orgId, launchId],
    );
    await walk(db, launchId, [["LAUNCH_TYPE_SELECTED", "PREPARATION", "system"]]);
    await expect(db.query("update public.launches set launch_type = 'cohosted_launch' where id = $1", [launchId])).rejects.toThrow(/locked/);
  });
});

describe("payment gate (C2)", () => {
  it("blocks preparation until a successful payment exists", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "pay-app");
    await walk(db, launchId, toQualified);
    await db.query("update public.launches set launch_type = 'founder_demo' where id = $1", [launchId]);
    await walk(db, launchId, [["QUALIFIED", "LAUNCH_TYPE_SELECTED", "founder"]]);
    await expect(walk(db, launchId, [["LAUNCH_TYPE_SELECTED", "PREPARATION", "system"]])).rejects.toThrow(/PAYMENT_REQUIRED/);
  });

  it("does not let founders record their own payment", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "fake-pay-app");
    await expect(
      asUser(db, alice.userId, () =>
        db.query(
          "insert into public.launch_payments (organization_id, launch_id, provider, provider_payment_id, amount, currency, status) values ($1, $2, 'stripe', 'pi_fake', 0, 'usd', 'succeeded')",
          [alice.orgId, launchId],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("goals (§56)", () => {
  it("keeps exactly one primary goal and mirrors it onto the launch", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "goal-app");
    await asUser(db, alice.userId, async () => {
      const a = await db.query<{ id: string }>(
        "insert into public.launch_goals (organization_id, launch_id, goal_type, created_by) values ($1, $2, 'signup', $3) returning id",
        [alice.orgId, launchId, alice.userId],
      );
      const b = await db.query<{ id: string }>(
        "insert into public.launch_goals (organization_id, launch_id, goal_type, target_value, created_by) values ($1, $2, 'purchase', 20, $3) returning id",
        [alice.orgId, launchId, alice.userId],
      );
      await db.query("select public.set_primary_goal($1)", [a.rows[0].id]);
      await db.query("select public.set_primary_goal($1)", [b.rows[0].id]);
    });
    const g = await db.query<{ goal_type: string }>("select goal_type from public.launch_goals where launch_id = $1 and is_primary", [launchId]);
    expect(g.rows).toEqual([{ goal_type: "purchase" }]);
    const l = await db.query<{ primary_goal_type: string }>("select primary_goal_type from public.launches where id = $1", [launchId]);
    expect(l.rows[0].primary_goal_type).toBe("purchase");
  });

  it("rejects an unknown goal type", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "bad-goal-app");
    await expect(
      db.query("insert into public.launch_goals (organization_id, launch_id, goal_type) values ($1, $2, 'vibes')", [alice.orgId, launchId]),
    ).rejects.toThrow();
  });

  it("does not let another organization add goals to a launch", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "cross-goal-app");
    await expect(
      asUser(db, bob.userId, () =>
        db.query("insert into public.launch_goals (organization_id, launch_id, goal_type, created_by) values ($1, $2, 'signup', $3)", [
          alice.orgId,
          launchId,
          bob.userId,
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe("qualification (§9, §53)", () => {
  it("lets founders read the outcome but never write reviews or decisions", async () => {
    const { versionId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "qual-app");
    const q = await db.query<{ id: string }>(
      "insert into public.qualifications (organization_id, app_version_id) values ($1, $2) returning id",
      [alice.orgId, versionId],
    );
    await db.query(
      "insert into public.qualification_events (organization_id, qualification_id, app_version_id, area, status, notes, reviewer_id) values ($1, $2, $3, 'security', 'pass', 'internal note', $4), ($1, $2, $3, 'decision', 'qualified', 'Approved', $4)",
      [alice.orgId, q.rows[0].id, versionId, staffId],
    );
    await asUser(db, alice.userId, async () => {
      const ev = await db.query<{ area: string }>("select area from public.qualification_events where qualification_id = $1", [q.rows[0].id]);
      expect(ev.rows).toEqual([{ area: "decision" }]); // internal area notes stay hidden
      await expect(db.query("update public.qualifications set status = 'qualified' where id = $1", [q.rows[0].id])).resolves.toMatchObject({ affectedRows: 0 });
    });
    await expect(
      asUser(db, alice.userId, () =>
        db.query(
          "insert into public.qualification_events (organization_id, qualification_id, app_version_id, area, status, reviewer_id) values ($1, $2, $3, 'decision', 'qualified', $4)",
          [alice.orgId, q.rows[0].id, versionId, alice.userId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("rejects an area status that isn't allowed", async () => {
    const { versionId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "qual-bad-app");
    const q = await db.query<{ id: string }>("insert into public.qualifications (organization_id, app_version_id) values ($1, $2) returning id", [alice.orgId, versionId]);
    await expect(
      db.query(
        "insert into public.qualification_events (organization_id, qualification_id, app_version_id, area, status, reviewer_id) values ($1, $2, $3, 'security', 'qualified', $4)",
        [alice.orgId, q.rows[0].id, versionId, staffId],
      ),
    ).rejects.toThrow();
  });
});

describe("intake (§52)", () => {
  it("keeps AI interpretation separate and read-only for founders", async () => {
    const { appId, versionId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "intake-app");
    const i = await db.query<{ id: string }>(
      "insert into public.app_intakes (organization_id, app_id, app_version_id, founder_description, created_by) values ($1, $2, $3, 'My words', $4) returning id",
      [alice.orgId, appId, versionId, alice.userId],
    );
    await db.query(
      "insert into public.product_understandings (organization_id, app_intake_id, app_version_id, source, output) values ($1, $2, $3, 'mock', '{\"summary\":\"[MOCK]\"}')",
      [alice.orgId, i.rows[0].id, versionId],
    );
    const intake = await db.query<{ founder_description: string }>("select founder_description from public.app_intakes where id = $1", [i.rows[0].id]);
    expect(intake.rows[0].founder_description).toBe("My words");
    await expect(
      asUser(db, alice.userId, () =>
        db.query("insert into public.product_understandings (organization_id, app_intake_id, app_version_id, source, output) values ($1, $2, $3, 'openai', '{}')", [
          alice.orgId,
          i.rows[0].id,
          versionId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("locks a submitted intake from founder edits", async () => {
    const { appId, versionId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "submitted-intake-app");
    const i = await db.query<{ id: string }>(
      "insert into public.app_intakes (organization_id, app_id, app_version_id, status, submitted_at, created_by) values ($1, $2, $3, 'submitted', now(), $4) returning id",
      [alice.orgId, appId, versionId, alice.userId],
    );
    const r = await asUser(db, alice.userId, () => db.query("update public.app_intakes set problem_solved = 'changed' where id = $1", [i.rows[0].id]));
    expect(r.affectedRows).toBe(0);
  });
});

describe("create_app_with_intake", () => {
  it("creates app, version 1 and intake atomically for the founder's own org only", async () => {
    const appId = await asUser(db, alice.userId, async () => {
      const r = await db.query<{ id: string }>(
        "select public.create_app_with_intake($1, 'Scorer', 'scorer', 'https://scorer.example', 'Scores leads', 'SaaS', 'b2b', 'Alice', 'Alice Co') as id",
        [alice.orgId],
      );
      return r.rows[0].id;
    });
    const v = await db.query("select 1 from public.app_versions where app_id = $1 and version_number = 1", [appId]);
    const i = await db.query<{ status: string }>("select status from public.app_intakes where app_id = $1", [appId]);
    expect(v.rows.length).toBe(1);
    expect(i.rows[0].status).toBe("in_progress");
    await expect(
      asUser(db, bob.userId, () =>
        db.query("select public.create_app_with_intake($1, 'X', 'x-app', null, null, null, null, null, null)", [alice.orgId]),
      ),
    ).rejects.toThrow();
    const leftovers = await db.query("select 1 from public.apps where slug = 'x-app'");
    expect(leftovers.rows.length).toBe(0);
  });
});

describe("operator qualification functions", () => {
  async function newQualification(slug: string) {
    const { versionId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, slug);
    const q = await db.query<{ id: string }>("insert into public.qualifications (organization_id, app_version_id) values ($1, $2) returning id", [alice.orgId, versionId]);
    return q.rows[0].id;
  }
  const areas = ["functionality", "security", "privacy", "fraud", "brand_ip", "launch_readiness"];

  it("can't be called by signed-in users", async () => {
    const q = await newQualification("fn-guard-app");
    await expect(
      asUser(db, staffId, () => db.query("select public.qualification_decide($1, 'qualified', null, $2)", [q, staffId])),
    ).rejects.toThrow();
  });

  it("won't qualify until every area passes, then records the decision", async () => {
    const q = await newQualification("fn-decide-app");
    await expect(db.query("select public.qualification_decide($1, 'qualified', null, $2)", [q, staffId])).rejects.toThrow(/every area/);
    for (const a of areas) {
      await db.query("select public.qualification_review_area($1, $2, $3, 'checked', $4)", [q, a, a === "fraud" ? "n_a" : "pass", staffId]);
    }
    await db.query("select public.qualification_decide($1, 'qualified', 'Looks good', $2)", [q, staffId]);
    const r = await db.query<{ status: string; reviewed_at: string | null }>("select status, reviewed_at from public.qualifications where id = $1", [q]);
    expect(r.rows[0].status).toBe("qualified");
    expect(r.rows[0].reviewed_at).not.toBeNull();
    const ev = await db.query("select 1 from public.qualification_events where qualification_id = $1", [q]);
    expect(ev.rows.length).toBe(7);
    await expect(db.query("select public.qualification_decide($1, 'rejected', 'late', $2)", [q, staffId])).rejects.toThrow(/already/);
  });

  it("requires notes when asking for changes", async () => {
    const q = await newQualification("fn-notes-app");
    await expect(db.query("select public.qualification_decide($1, 'changes_required', '  ', $2)", [q, staffId])).rejects.toThrow(/explain/);
  });
});

describe("app version lock (§51)", () => {
  it("freezes a qualified version and lets the founder start the next one", async () => {
    const appId = await asUser(db, alice.userId, async () =>
      (await db.query<{ id: string }>("select public.create_app_with_intake($1, 'Locked', 'locked-app', 'https://a.example', 'd', 'SaaS', null, 'A', 'B') as id", [alice.orgId])).rows[0].id,
    );
    const v1 = (await db.query<{ id: string }>("select id from public.app_versions where app_id = $1", [appId])).rows[0].id;
    await db.query("insert into public.qualifications (organization_id, app_version_id, status) values ($1, $2, 'qualified')", [alice.orgId, v1]);
    await expect(
      asUser(db, alice.userId, () => db.query("update public.app_versions set privacy_url = 'https://a.example/p' where id = $1", [v1])),
    ).rejects.toThrow(/new version/);
    const v2 = await asUser(db, alice.userId, async () =>
      (await db.query<{ id: string }>("select public.create_next_app_version($1) as id", [appId])).rows[0].id,
    );
    const r = await db.query<{ version_number: number; product_url: string }>("select version_number, product_url from public.app_versions where id = $1", [v2]);
    expect(r.rows[0]).toEqual({ version_number: 2, product_url: "https://a.example" });
    const i = await db.query<{ founder_name: string; status: string }>("select founder_name, status from public.app_intakes where app_version_id = $1", [v2]);
    expect(i.rows[0]).toEqual({ founder_name: "A", status: "in_progress" });
  });
});

describe("end-to-end Phase 2 flow at the database layer", () => {
  it("intake, operator review, changes, resubmit, qualify, format, goals, and payment gate", async () => {
    // Founder creates the app (v1 + intake) and a DRAFT launch.
    const appId = await asUser(db, alice.userId, async () =>
      (await db.query<{ id: string }>("select public.create_app_with_intake($1, 'Flow', 'flow-app', 'https://flow.example', 'd', 'SaaS', 'b2b', 'A', 'B') as id", [alice.orgId])).rows[0].id,
    );
    const v1 = (await db.query<{ id: string }>("select id from public.app_versions where app_id = $1", [appId])).rows[0].id;
    const launchId = await asUser(db, alice.userId, async () =>
      (await db.query<{ id: string }>("insert into public.launches (organization_id, app_id, app_version_id, created_by) values ($1, $2, $3, $4) returning id", [alice.orgId, appId, v1, alice.userId])).rows[0].id,
    );
    // Submit: qualification opens, launch goes to review.
    await db.query("update public.app_intakes set status = 'submitted', submitted_at = now() where app_version_id = $1", [v1]);
    const q1 = (await db.query<{ id: string }>("insert into public.qualifications (organization_id, app_version_id, launch_id) values ($1, $2, $3) returning id", [alice.orgId, v1, launchId])).rows[0].id;
    await walk(db, launchId, [["DRAFT", "INTAKE_IN_PROGRESS", "founder"], ["INTAKE_IN_PROGRESS", "SUBMITTED", "founder"], ["SUBMITTED", "QUALIFICATION_REVIEW", "system"]]);

    // Operator asks for changes; the founder sees only the decision event, not internal area notes.
    await db.query("select public.qualification_review_area($1, 'privacy', 'fail', 'internal: no policy', $2)", [q1, staffId]);
    await db.query("select public.qualification_decide($1, 'changes_required', 'Add a privacy policy link', $2)", [q1, staffId]);
    await walk(db, launchId, [["QUALIFICATION_REVIEW", "CHANGES_REQUIRED", "operator"]]);
    await db.query("update public.app_intakes set status = 'in_progress', submitted_at = null where app_version_id = $1", [v1]);
    const seen = await asUser(db, alice.userId, () => db.query<{ area: string }>("select area from public.qualification_events where qualification_id = $1", [q1]));
    expect(seen.rows.map((r) => r.area)).toEqual(["decision"]);

    // Founder can edit v1 again (not qualified), resubmits; a new qualification opens.
    await asUser(db, alice.userId, () => db.query("update public.app_versions set privacy_url = 'https://flow.example/privacy' where id = $1", [v1]));
    const q2 = (await db.query<{ id: string }>("insert into public.qualifications (organization_id, app_version_id, launch_id) values ($1, $2, $3) returning id", [alice.orgId, v1, launchId])).rows[0].id;
    await walk(db, launchId, [["CHANGES_REQUIRED", "SUBMITTED", "founder"], ["SUBMITTED", "QUALIFICATION_REVIEW", "system"]]);
    for (const a of ["functionality", "security", "privacy", "fraud", "brand_ip", "launch_readiness"]) {
      await db.query("select public.qualification_review_area($1, $2, 'pass', null, $3)", [q2, a, staffId]);
    }
    await db.query("select public.qualification_decide($1, 'qualified', null, $2)", [q2, staffId]);
    await walk(db, launchId, [["QUALIFICATION_REVIEW", "QUALIFIED", "operator"]]);

    // Format choice snapshots the price; goals need exactly one primary.
    await asUser(db, alice.userId, () => db.query("update public.launches set launch_type = 'founder_demo' where id = $1", [launchId]));
    await walk(db, launchId, [["QUALIFIED", "LAUNCH_TYPE_SELECTED", "founder"]]);
    const goals = await asUser(db, alice.userId, async () => {
      const g1 = (await db.query<{ id: string }>("insert into public.launch_goals (organization_id, launch_id, goal_type, created_by) values ($1, $2, 'signup', $3) returning id", [alice.orgId, launchId, alice.userId])).rows[0].id;
      const g2 = (await db.query<{ id: string }>("insert into public.launch_goals (organization_id, launch_id, goal_type, target_value, created_by) values ($1, $2, 'trial', 40, $3) returning id", [alice.orgId, launchId, alice.userId])).rows[0].id;
      await db.query("select public.set_primary_goal($1)", [g1]);
      await db.query("select public.set_primary_goal($1)", [g2]);
      return db.query<{ n: number }>("select count(*)::int as n from public.launch_goals where launch_id = $1 and is_primary", [launchId]);
    });
    expect(goals.rows[0].n).toBe(1);
    const l = await db.query<{ price_amount: number; primary_goal_type: string }>("select price_amount, primary_goal_type from public.launches where id = $1", [launchId]);
    expect(l.rows[0]).toEqual({ price_amount: 49900, primary_goal_type: "trial" });

    // No payment, no preparation (C2).
    await expect(walk(db, launchId, [["LAUNCH_TYPE_SELECTED", "PREPARATION", "system"]])).rejects.toThrow(/PAYMENT_REQUIRED/);
    // The qualified version is now frozen.
    await expect(db.query("update public.app_versions set terms_url = 'https://flow.example/t' where id = $1", [v1])).rejects.toThrow(/new version/);
  });
});
