// PRD v1.4 migrations (db/migrations/0002+): reversible, additive, and constrained at the database.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb, createUser, seedAppAndLaunch } from "./db";

let db: PGlite;
let alice: { userId: string; orgId: string };
let bob: { userId: string; orgId: string };

beforeAll(async () => {
  db = await bootDb();
  alice = await createUser(db, "alice-v14@example.com", "Alice v14");
  bob = await createUser(db, "bob-v14@example.com", "Bob v14");
});

const ROLLBACKS = join(__dirname, "..", "db", "rollbacks");
const MIGRATIONS = join(__dirname, "..", "db", "migrations");
const v14 = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f !== "0001_baseline.sql").sort();

describe("v1.4 migrations are additive and reversible", () => {
  it("every v1.4 migration has a rollback, and down then up leaves a working schema", async () => {
    const ups = v14();
    expect(ups.length).toBeGreaterThan(0);
    const fresh = await bootDb();
    for (const up of [...ups].reverse()) await fresh.exec(readFileSync(join(ROLLBACKS, up.replace(/\.sql$/, ".down.sql")), "utf8"));
    for (const up of ups) await fresh.exec(readFileSync(join(MIGRATIONS, up), "utf8"));
    await fresh.close();
  });
  it("v1.4 migrations never drop or rename existing objects", () => {
    for (const f of v14()) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8").replace(/--.*$/gm, "");
      expect(sql).not.toMatch(/\bdrop\s+(table|column|type|function)\b|\brename\b/i);
    }
  });
});

describe("R3 truth sheets", () => {
  const ins = (orgId: string, launchId: string, version: number, status = "draft", by: string | null = null) =>
    db.query("insert into public.launch_truth_sheets (organization_id, launch_id, version, status, items, approved_by, approved_at) values ($1,$2,$3,$4,'[]',$5,$6)",
      [orgId, launchId, version, status, by, by ? new Date().toISOString() : null]);

  it("versions, allows one approved, and requires an approver", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "ts-v");
    await ins(alice.orgId, launchId, 1, "approved", alice.userId);
    await expect(ins(alice.orgId, launchId, 1)).rejects.toThrow();
    await expect(ins(alice.orgId, launchId, 2, "approved", alice.userId)).rejects.toThrow();
    await expect(ins(alice.orgId, launchId, 3, "approved", null)).rejects.toThrow();
    await expect(db.query("insert into public.launch_truth_sheets (organization_id, launch_id, version, items) values ($1,$2,9,'{}')", [alice.orgId, launchId])).rejects.toThrow();
  });
  it("rejects a sheet tied to another org's launch", async () => {
    const { launchId } = await seedAppAndLaunch(db, alice.orgId, alice.userId, "ts-x");
    await expect(ins(bob.orgId, launchId, 1)).rejects.toThrow();
  });
});
