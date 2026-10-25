import { describe, expect, it, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { bootDb, createUser, seedAppAndLaunch } from "./db";

let db: PGlite;
let alice: { userId: string; orgId: string };

beforeAll(async () => {
  db = await bootDb();
  alice = await createUser(db, "alice@example.com", "Alice Co");
});

const insertOrder = (orgId: string, launchId: string, sessionId: string) =>
  db.query(
    "insert into public.launch_orders (id, organization_id, launch_id, stripe_session_id, amount, currency) values ($1, $2, $3, $4, 49900, 'usd') returning id, status, paid_at",
    [randomUUID(), orgId, launchId, sessionId],
  );

describe("checkout orders", () => {
  it("starts pending with no paid_at, and the pending-only update flips it exactly once", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "order-app");
    const r = await insertOrder(alice.orgId, launchId, "cs_test_flip");
    expect(r.rows[0]).toMatchObject({ status: "pending", paid_at: null });
    const flip = "update public.launch_orders set status = 'paid', paid_at = now() where stripe_session_id = 'cs_test_flip' and status = 'pending' returning id";
    expect((await db.query(flip)).rows.length).toBe(1);
    expect((await db.query(flip)).rows.length).toBe(0); // replayed webhook changes nothing
  });

  it("rejects duplicate sessions and paid without paid_at", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "order-dupe-app");
    await insertOrder(alice.orgId, launchId, "cs_test_dupe");
    await expect(insertOrder(alice.orgId, launchId, "cs_test_dupe")).rejects.toThrow();
    await expect(db.query("update public.launch_orders set status = 'paid' where stripe_session_id = 'cs_test_dupe'")).rejects.toThrow();
  });
});
