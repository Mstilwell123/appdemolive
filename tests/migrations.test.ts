import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb } from "./db";

describe("baseline migration", () => {
  it("rolls back cleanly and re-applies", async () => {
    const db = await bootDb();
    const root = join(__dirname, "..", "db");
    await db.exec(readFileSync(join(root, "rollbacks", "0001_baseline.down.sql"), "utf8"));
    const left = await db.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
    expect(left.rows[0].n).toBe(0);
    await db.exec(readFileSync(join(root, "migrations", "0001_baseline.sql"), "utf8"));
    const prices = await db.query<{ launch_type: string; amount: number }>("select launch_type, amount from public.launch_prices order by amount");
    expect(prices.rows).toEqual([{ launch_type: "founder_demo", amount: 49900 }, { launch_type: "cohosted_launch", amount: 79900 }]);
  });
});
