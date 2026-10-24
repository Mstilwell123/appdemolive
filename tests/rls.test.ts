import { describe, expect, it, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, bootDb, createUser } from "./db";

let db: PGlite;
let alice: { userId: string; orgId: string };
let bob: { userId: string; orgId: string };
let aliceLaunchId: string;

/** Seeds an app, version and launch directly as the database owner. */
async function seedLaunch(orgId: string, userId: string, slug: string) {
  const app = await db.query<{ id: string }>(
    "insert into public.apps (organization_id, name, slug, created_by) values ($1, $2, $3, $4) returning id",
    [orgId, slug, slug, userId],
  );
  const ver = await db.query<{ id: string }>(
    "insert into public.app_versions (organization_id, app_id, version_label, version_number) values ($1, $2, 'v1', 1) returning id",
    [orgId, app.rows[0].id],
  );
  const launch = await db.query<{ id: string }>(
    "insert into public.launches (organization_id, app_id, app_version_id, created_by) values ($1, $2, $3, $4) returning id",
    [orgId, app.rows[0].id, ver.rows[0].id, userId],
  );
  return { appId: app.rows[0].id, launchId: launch.rows[0].id };
}

beforeAll(async () => {
  db = await bootDb();
  alice = await createUser(db, "alice@example.com", "Alice Co");
  bob = await createUser(db, "bob@example.com", "Bob Co");
  aliceLaunchId = (await seedLaunch(alice.orgId, alice.userId, "alice-app")).launchId;
  await seedLaunch(bob.orgId, bob.userId, "bob-app");
});

describe("signup trigger", () => {
  it("creates a profile, a personal organization and an owner membership", async () => {
    const r = await db.query<{ role: string; name: string }>(
      `select m.role, o.name from public.organization_members m join public.organizations o on o.id = m.organization_id where m.user_id = $1`,
      [alice.userId],
    );
    expect(r.rows).toEqual([{ role: "owner", name: "Alice Co" }]);
    const p = await db.query("select 1 from public.profiles where id = $1", [alice.userId]);
    expect(p.rows.length).toBe(1);
  });
});

describe("row-level security", () => {
  it("shows each user only their own organization's rows", async () => {
    await asUser(db, alice.userId, async () => {
      for (const table of ["organizations", "organization_members", "apps", "app_versions", "launches"]) {
        const r = await db.query<{ organization_id?: string; id: string }>(`select * from public.${table}`);
        expect(r.rows.length, table).toBeGreaterThan(0);
        for (const row of r.rows) {
          const org = table === "organizations" ? row.id : row.organization_id;
          expect(org, table).toBe(alice.orgId);
        }
      }
    });
  });

  it("hides another tenant's launch by id", async () => {
    await asUser(db, bob.userId, async () => {
      const r = await db.query("select * from public.launches where id = $1", [aliceLaunchId]);
      expect(r.rows.length).toBe(0);
    });
  });

  it("blocks inserting an app into another organization", async () => {
    await expect(
      asUser(db, bob.userId, () =>
        db.query("insert into public.apps (organization_id, name, slug) values ($1, 'x', 'sneaky')", [alice.orgId]),
      ),
    ).rejects.toThrow();
  });

  it("blocks a founder from changing launch status directly", async () => {
    await expect(
      asUser(db, alice.userId, () => db.query("update public.launches set status = 'LIVE' where id = $1", [aliceLaunchId])),
    ).rejects.toThrow();
  });

  it("blocks founders from reading platform staff", async () => {
    await asUser(db, alice.userId, async () => {
      const r = await db.query("select * from public.platform_staff");
      expect(r.rows.length).toBe(0);
    });
  });
});

describe("transition_launch()", () => {
  it("cannot be called by a signed-in user", async () => {
    await expect(
      asUser(db, alice.userId, () =>
        db.query("select public.transition_launch($1, 'DRAFT', 'INTAKE_IN_PROGRESS', $2, 'founder', null)", [aliceLaunchId, alice.userId]),
      ),
    ).rejects.toThrow();
  });

  it("moves a launch and records history", async () => {
    await db.query("select public.transition_launch($1, 'DRAFT', 'INTAKE_IN_PROGRESS', $2, 'founder', 'started')", [aliceLaunchId, alice.userId]);
    const l = await db.query<{ status: string }>("select status from public.launches where id = $1", [aliceLaunchId]);
    expect(l.rows[0].status).toBe("INTAKE_IN_PROGRESS");
    const h = await db.query<{ from_status: string; to_status: string }>(
      "select from_status, to_status from public.launch_state_history where launch_id = $1",
      [aliceLaunchId],
    );
    expect(h.rows).toEqual([{ from_status: "DRAFT", to_status: "INTAKE_IN_PROGRESS" }]);
  });

  it("rejects a stale expected status", async () => {
    await expect(
      db.query("select public.transition_launch($1, 'DRAFT', 'INTAKE_IN_PROGRESS', $2, 'founder', null)", [aliceLaunchId, alice.userId]),
    ).rejects.toThrow();
  });

  it("rejects an invalid jump and the wrong actor", async () => {
    await expect(
      db.query("select public.transition_launch($1, 'INTAKE_IN_PROGRESS', 'LIVE', $2, 'operator', null)", [aliceLaunchId, alice.userId]),
    ).rejects.toThrow();
    await db.query("select public.transition_launch($1, 'INTAKE_IN_PROGRESS', 'SUBMITTED', $2, 'founder', null)", [aliceLaunchId, alice.userId]);
    await db.query("select public.transition_launch($1, 'SUBMITTED', 'QUALIFICATION_REVIEW', null, 'system', null)", [aliceLaunchId]);
    await expect(
      db.query("select public.transition_launch($1, 'QUALIFICATION_REVIEW', 'QUALIFIED', $2, 'founder', null)", [aliceLaunchId, alice.userId]),
    ).rejects.toThrow();
  });
});
