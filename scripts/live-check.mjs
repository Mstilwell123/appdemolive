// Read-only checks against the live Supabase project using the public (anon) key.
// Run: node --env-file=.env.local scripts/live-check.mjs
import { createClient } from "@supabase/supabase-js";
// Node 20 has no native WebSocket. Realtime is never opened here, so a placeholder transport is enough.
class NoSocket {}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: NoSocket } });

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const prices = await sb.from("launch_prices").select("launch_type, amount, currency");
check("public can read active launch prices (2 rows)", !prices.error && prices.data?.length === 2, prices.error?.message ?? JSON.stringify(prices.data));

for (const t of ["organizations", "profiles", "apps", "app_intakes", "launches", "launch_payments", "platform_staff", "qualification_events"]) {
  const r = await sb.from(t).select("*").limit(1);
  check(`signed-out visitor sees no rows in ${t}`, !r.error ? r.data.length === 0 : true, r.error?.message ?? "0 rows");
}

const tl = await sb.rpc("transition_launch", { p_launch_id: "00000000-0000-0000-0000-000000000000", p_expected_from: "DRAFT", p_to: "INTAKE_IN_PROGRESS", p_actor_id: null, p_actor_kind: "founder" });
check("signed-out visitor cannot change a launch status", Boolean(tl.error), tl.error?.message ?? "call was allowed");

const qd = await sb.rpc("qualification_decide", { p_qualification_id: "00000000-0000-0000-0000-000000000000", p_decision: "qualified", p_notes: "", p_reviewer_id: "00000000-0000-0000-0000-000000000000" });
check("signed-out visitor cannot qualify an app", Boolean(qd.error), qd.error?.message ?? "call was allowed");

const om = await sb.rpc("is_org_member", { p_org: "00000000-0000-0000-0000-000000000000" });
check("signed-out visitor cannot call membership helper", Boolean(om.error), om.error?.message ?? "call was allowed");

const ins = await sb.from("apps").insert({ organization_id: "00000000-0000-0000-0000-000000000000", name: "x", slug: "x" });
check("signed-out visitor cannot create an app", Boolean(ins.error), ins.error?.message ?? "insert was allowed");

let pass = 0;
for (const r of results) { console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.detail})`); if (r.ok) pass++; }
console.log(`\n${pass}/${results.length} live checks passed`);
process.exit(pass === results.length ? 0 : 1);
