// Better Auth magic-link sign-up against the real schema (PGlite): the users row it creates fires
// handle_new_user, which reads signup_intents and makes the founder's organization.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import type { Db } from "@/lib/db";
import { bootDb } from "./db";

vi.mock("server-only", () => ({}));
const sent: Array<{ to: string; url: string }> = [];
vi.mock("@/integrations/email", () => ({
  getEmailSender: () => ({ name: "test", sendSignInLink: async (m: { to: string; url: string }) => void sent.push(m) }),
}));

let pg: PGlite;
let auth: Awaited<ReturnType<typeof makeAuth>>;
const makeAuth = async (db: Db) => (await import("@/lib/auth")).createAuth(db, "test-secret-test-secret-test-secret-32");

beforeAll(async () => {
  pg = await bootDb();
  auth = await makeAuth(drizzle(pg, { schema }) as unknown as Db);
});

describe("magic-link sign-up", () => {
  it("creates the user, their organization, and a session; sign-out ends it", async () => {
    await pg.query("insert into public.signup_intents (email, full_name, organization_name) values ('new@example.com', 'New Founder', 'New Co')");
    await auth.api.signInMagicLink({ body: { email: "new@example.com", name: "New Founder", callbackURL: "/dashboard" }, headers: new Headers() });
    expect(sent).toHaveLength(1);
    const token = new URL(sent[0].url).searchParams.get("token")!;
    expect(token).toBeTruthy();

    const res = await auth.api.magicLinkVerify({ query: { token, callbackURL: "/dashboard" }, headers: new Headers(), asResponse: true });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="));
    expect(cookie).toBeTruthy();

    const org = await pg.query<{ name: string; role: string; email_verified: boolean }>(
      "select o.name, m.role, u.email_verified from public.users u join public.organization_members m on m.user_id = u.id join public.organizations o on o.id = m.organization_id where u.email = 'new@example.com'",
    );
    expect(org.rows).toEqual([{ name: "New Co", role: "owner", email_verified: true }]);

    const headers = new Headers({ cookie: cookie!.split(";")[0] });
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe("new@example.com");
    await auth.api.signOut({ headers });
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it("rejects a reused link", async () => {
    sent.length = 0;
    await auth.api.signInMagicLink({ body: { email: "new@example.com", callbackURL: "/dashboard" }, headers: new Headers() });
    const token = new URL(sent[0].url).searchParams.get("token")!;
    await auth.api.magicLinkVerify({ query: { token }, headers: new Headers(), asResponse: true });
    const again = await auth.api.magicLinkVerify({ query: { token, errorCallbackURL: "/login?error=link" }, headers: new Headers(), asResponse: true });
    expect(again.headers.get("location") ?? "").toContain("error");
  });
});
