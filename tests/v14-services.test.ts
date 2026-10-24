// PRD v1.4 services run against PGlite with the signed-in user swapped per test.
// There is no row-level security on Neon, so these prove the server-side ownership checks.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { setDbForTests, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/session-user";
import { bootDb, createUser, seedAppAndLaunch } from "./db";

vi.mock("server-only", () => ({}));
let current: SessionUser | null = null;
vi.mock("@/lib/session-user", () => ({ getSessionUser: async () => current }));

type Account = { userId: string; orgId: string; email: string };
let pg: PGlite;
let alice: Account;
let bob: Account;
let staff: Account;
const signIn = (a: Account | null) => { current = a ? { id: a.userId, email: a.email, name: a.email } : null; };
const NF = { code: "NOT_FOUND" };

beforeAll(async () => {
  pg = await bootDb();
  setDbForTests(drizzle(pg, { schema }) as unknown as Db);
  const mk = async (email: string, org: string) => ({ ...(await createUser(pg, email, org)), email });
  alice = await mk("alice-s@example.com", "Alice S");
  bob = await mk("bob-s@example.com", "Bob S");
  staff = await mk("op-s@pragvance.ai", "Ops");
  await pg.query("insert into public.platform_staff (user_id, role) values ($1, 'operator')", [staff.userId]);
});

describe("R3 truth sheet service", () => {
  it("drafts, versions, approves, and hides everything from other orgs", async () => {
    const ts = await import("@/services/truth-sheet");
    const { launchId } = await seedAppAndLaunch(pg, alice.orgId, alice.userId, "svc-ts");
    signIn(alice);
    await ts.startTruthSheet(launchId);
    await ts.startTruthSheet(launchId);
    expect((await ts.getTruthSheet(launchId)).current?.version).toBe(1);
    const items = [
      { category: "buyer", kind: "confirmed", statement: "Freelancers" },
      { category: "problem", kind: "confirmed", statement: "Late payments" },
      { category: "product", kind: "confirmed", statement: "Schedules invoices" },
      { category: "benefit", kind: "confirmed", statement: "Paid on time" },
      { category: "pricing", kind: "confirmed", statement: "$19/month", evidenceUrl: "https://example.com/pricing" },
      { category: "free_trial", kind: "confirmed", statement: "No free trial", evidenceUrl: "https://example.com/pricing" },
      { category: "cta", kind: "confirmed", statement: "Start a schedule" },
    ] as never;
    await ts.saveTruthSheet(launchId, items);
    const before = await ts.getTruthSheet(launchId);
    expect(before.current?.version).toBe(2);

    signIn(bob);
    await expect(ts.getTruthSheet(launchId)).rejects.toMatchObject(NF);
    await expect(ts.saveTruthSheet(launchId, items)).rejects.toMatchObject(NF);
    await expect(ts.approveTruthSheet(launchId)).rejects.toMatchObject(NF);

    signIn(staff);
    await expect(ts.approveTruthSheet(launchId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    signIn(alice);
    expect(before.blockers).toEqual([]);
    await ts.approveTruthSheet(launchId);
    expect((await ts.getTruthSheet(launchId)).approved?.version).toBe(2);
    await ts.saveTruthSheet(launchId, items);
    const after = await ts.getTruthSheet(launchId);
    expect(after.current?.status).toBe("draft");
    expect(after.approved?.version).toBe(2);
    signIn(null);
    await expect(ts.getTruthSheet(launchId)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
