// Live smoke test of the founder + operator path against the real Supabase project.
// Run: npx vitest run --config scripts/smoke/vitest.smoke.config.ts
// Creates one clearly labelled test account and its data; nothing else is modified.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
let userClient: SupabaseClient;
vi.mock("@/lib/supabase/server", async () => {
  const real = await vi.importActual<typeof import("@/lib/supabase/server")>("@/lib/supabase/server");
  return { ...real, getUserClient: async () => userClient };
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const email = `smoke+${stamp}@appdemo.test`;
const password = `Smoke-${stamp}-pw!`;
let userId = "";

describe("live founder + operator path", () => {
  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "SMOKE TEST" } });
    if (error) throw error;
    userId = data.user.id;
    userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const s = await userClient.auth.signInWithPassword({ email, password });
    if (s.error) throw s.error;
  });

  it("walks sign-up to payment stub", async () => {
    const { data: profile } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    expect(profile, "signup trigger created profile").toBeTruthy();

    const apps = await import("@/services/apps");
    const setup = await import("@/services/launch-setup");
    const qual = await import("@/services/qualification");
    const launches = await import("@/services/launches");
    const { QUALIFICATION_AREAS } = await import("@/schemas/qualification");

    const appId = await apps.createApp({ name: `SMOKE TEST ${stamp}`, websiteUrl: "https://example.com", category: "SaaS",
      description: "Smoke test app", businessType: "b2b", founderName: "Smoke Tester", companyName: "Smoke Co" } as never);
    const draft = { founderName: "Smoke Tester", companyName: "Smoke Co", founderDescription: "Test", targetCustomer: "Testers",
      problemSolved: "Testing", desiredOutcome: "Pass", desiredAction: "Sign up" };
    const urls = { productUrl: "https://example.com", privacyUrl: "https://example.com/privacy", termsUrl: "https://example.com/terms", pricingUrl: null };
    await apps.saveIntake(appId, draft as never, urls);
    const launchId = await setup.createLaunch(appId);
    await apps.submitIntake(appId, draft as never, urls);

    const statusOf = async () => (await admin.from("launches").select("status").eq("id", launchId).single()).data!.status;
    console.log("after submit:", await statusOf());

    // Not staff yet: operator actions must be refused server-side.
    const { data: ver } = await admin.from("app_versions").select("id").eq("app_id", appId).order("version_number", { ascending: false }).limit(1).single();
    const { data: q } = await admin.from("qualifications").select("id").eq("app_version_id", ver!.id).order("created_at", { ascending: false }).limit(1).single();
    await expect(qual.reviewArea(q!.id, "functionality", "pass", null)).rejects.toThrow();

    await admin.from("platform_staff").insert({ user_id: userId, role: "operator" });
    for (const a of QUALIFICATION_AREAS) await qual.reviewArea(q!.id, a, "pass", "smoke");
    await qual.decideQualification(q!.id, "qualified", "smoke test");
    expect(await statusOf()).toBe("QUALIFIED");

    await setup.chooseLaunchType(launchId, "founder_demo");
    expect(await statusOf()).toBe("LAUNCH_TYPE_SELECTED");
    await setup.addGoal(launchId, { goalType: "signup", targetValue: 50, destinationUrl: "https://example.com" });
    const next = await launches.getLaunchNextAction(launchId);
    console.log("next action:", JSON.stringify(next));
    const checkout = await setup.startCheckout(launchId, "http://localhost:3210").then((u) => `url:${u.checkoutUrl} order:${u.orderId}`, (e) => `error:${e.code ?? ""} ${e.message}`);
    console.log("checkout:", checkout);
    expect(await statusOf()).toBe("LAUNCH_TYPE_SELECTED"); // payment gate holds (C2)
    console.log("smoke user:", email, "launch:", launchId);
  });
});
