import "server-only";
import { AppError, fromDbError } from "@/domain/errors";
import { randomUUID } from "node:crypto";
import { getProviders } from "@/services/providers";
import { applyTransition, applyTransitions, transitionLaunch } from "@/services/launches";
import { requireFounder, requireService } from "@/services/session";
import type { LaunchStatus, LaunchType } from "@/types/launch";

const LAUNCH_TYPE_LABELS: Record<LaunchType, string> = { founder_demo: "Founder Demo", cohosted_launch: "Co-Hosted Launch Show" };

const ACTIVE_EXCLUDED: LaunchStatus[] = ["COMPLETED", "CANCELLED"];

/**
 * §6: a launch belongs to the organization, founder, app and the app's latest version. It starts
 * as DRAFT and is moved forward to match where that version already is in intake and review.
 */
export async function createLaunch(appId: string): Promise<string> {
  const { supabase, user, orgId } = await requireFounder();
  const service = requireService();

  const { data: app } = await supabase.from("apps").select("id, organization_id").eq("id", appId).maybeSingle();
  if (!app) throw new AppError("NOT_FOUND", "App not found");

  const { data: existing } = await supabase
    .from("launches")
    .select("id, status")
    .eq("app_id", appId)
    .not("status", "in", `(${ACTIVE_EXCLUDED.join(",")})`)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id; // one open launch per app; a double click lands on the same launch

  const { data: version } = await supabase
    .from("app_versions")
    .select("id")
    .eq("app_id", appId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version) throw new AppError("NOT_FOUND", "App version not found");

  const [{ data: intake }, { data: qualification }] = await Promise.all([
    supabase.from("app_intakes").select("status").eq("app_version_id", version.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    service
      .from("qualifications")
      .select("id, status, reviewer_id, launch_id")
      .eq("app_version_id", version.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (qualification?.status === "rejected") {
    throw new AppError("QUALIFICATION_REQUIRED", "This version wasn't approved for launch. Start a new version to try again.");
  }

  const { data: launch, error } = await supabase
    .from("launches")
    .insert({ organization_id: app.organization_id, app_id: appId, app_version_id: version.id, created_by: user.id })
    .select("id")
    .single();
  if (error) throw new AppError("INTERNAL_ERROR", "Could not create the launch");

  await service
    .from("launch_participants")
    .insert({ organization_id: orgId, launch_id: launch.id, user_id: user.id, role: "founder", status: "confirmed", created_by: user.id });

  const founder = { actorKind: "founder" as const, actorId: user.id };
  const steps: Parameters<typeof applyTransitions>[2] = [{ to: "INTAKE_IN_PROGRESS", ...founder }];
  if (intake?.status === "submitted") {
    steps.push({ to: "SUBMITTED", ...founder, reason: "Intake already submitted for this version" });
    steps.push({ to: "QUALIFICATION_REVIEW", actorKind: "system", actorId: null, reason: "Queued for operator review" });
    if (qualification?.status === "qualified") {
      // The operator already qualified this exact version; record their decision on the new launch.
      steps.push({ to: "QUALIFIED", actorKind: "operator", actorId: qualification.reviewer_id, reason: "Version already qualified by operator" });
    }
  }
  await applyTransitions(service, launch.id, steps);
  if (qualification && ["pending", "in_review"].includes(qualification.status) && !qualification.launch_id) {
    await service.from("qualifications").update({ launch_id: launch.id }).eq("id", qualification.id);
  }
  return launch.id;
}

export async function listLaunches() {
  const { supabase, orgId } = await requireFounder();
  const { data, error } = await supabase
    .from("launches")
    .select("id, status, launch_type, price_amount, currency, scheduled_at, primary_goal_type, created_at, apps(name), app_versions(version_label)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new AppError("INTERNAL_ERROR", "Could not load launches");
  return data ?? [];
}

export async function getLaunchDetail(launchId: string) {
  const { supabase } = await requireFounder();
  const { data: launch } = await supabase
    .from("launches")
    .select("*, apps(id, name, website_url), app_versions(id, version_label, version_number)")
    .eq("id", launchId)
    .maybeSingle();
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");

  const [goals, participants, history, prices, payments] = await Promise.all([
    supabase.from("launch_goals").select("id, goal_type, is_primary, target_value, destination_url, created_at").eq("launch_id", launchId).order("created_at"),
    supabase.from("launch_participants").select("id, role, status, external_name, user_id").eq("launch_id", launchId).order("created_at"),
    supabase.from("launch_state_history").select("id, from_status, to_status, actor_kind, reason, created_at").eq("launch_id", launchId).order("created_at", { ascending: false }),
    supabase.from("launch_prices").select("launch_type, amount, currency").order("amount"),
    supabase.from("launch_payments").select("id, status, amount, currency, created_at").eq("launch_id", launchId),
  ]);
  return {
    launch,
    goals: goals.data ?? [],
    participants: participants.data ?? [],
    history: history.data ?? [],
    prices: prices.data ?? [],
    payments: payments.data ?? [],
  };
}

export async function updateLaunchDetails(
  launchId: string,
  d: { objective: string | null; audience: string | null; ctaText: string | null; dmKeyword: string | null; trackedDestinationUrl: string | null },
) {
  const { supabase } = await requireFounder();
  const { data, error } = await supabase
    .from("launches")
    .update({ objective: d.objective, audience: d.audience, cta_text: d.ctaText, dm_keyword: d.dmKeyword, tracked_destination_url: d.trackedDestinationUrl })
    .eq("id", launchId)
    .not("status", "in", "(LIVE,COMPLETED,CANCELLED)")
    .select("id");
  if (error) throw fromDbError(error.message);
  if (!data?.length) throw new AppError("NOT_FOUND", "Launch not found or can no longer be edited");
}

/** §6/§12: choosing a format snapshots its price (database trigger) and, from QUALIFIED, records the choice. */
export async function chooseLaunchType(launchId: string, launchType: LaunchType) {
  const { supabase } = await requireFounder();
  const { data: launch } = await supabase.from("launches").select("id, status").eq("id", launchId).maybeSingle();
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");
  if (!["QUALIFIED", "LAUNCH_TYPE_SELECTED"].includes(launch.status)) {
    throw new AppError("QUALIFICATION_REQUIRED", "You can choose a format once your app is qualified");
  }
  const { error } = await supabase.from("launches").update({ launch_type: launchType }).eq("id", launchId);
  if (error) throw fromDbError(error.message);
  if (launch.status === "QUALIFIED") await transitionLaunch({ launchId, to: "LAUNCH_TYPE_SELECTED", actorKind: "founder" });
}

export async function addGoal(launchId: string, g: { goalType: string; targetValue: number | null; destinationUrl: string | null }) {
  const { supabase, user } = await requireFounder();
  const { data: launch } = await supabase.from("launches").select("id, organization_id").eq("id", launchId).maybeSingle();
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");
  const { count } = await supabase.from("launch_goals").select("id", { count: "exact", head: true }).eq("launch_id", launchId);
  const { data: goal, error } = await supabase
    .from("launch_goals")
    .insert({ organization_id: launch.organization_id, launch_id: launchId, goal_type: g.goalType, target_value: g.targetValue, destination_url: g.destinationUrl, created_by: user.id })
    .select("id")
    .single();
  if (error) throw new AppError("VALIDATION_FAILED", "Goals can't be changed at this stage");
  if ((count ?? 0) === 0) await setPrimaryGoal(goal.id); // the first goal is primary by default
}

export async function setPrimaryGoal(goalId: string) {
  const { supabase } = await requireFounder();
  const { error } = await supabase.rpc("set_primary_goal", { p_goal_id: goalId });
  if (error) throw fromDbError(error.message);
}

export async function removeGoal(goalId: string) {
  const { supabase } = await requireFounder();
  const { data: goal } = await supabase.from("launch_goals").select("id, launch_id, is_primary").eq("id", goalId).maybeSingle();
  if (!goal) throw new AppError("NOT_FOUND", "Goal not found");
  const { data, error } = await supabase.from("launch_goals").delete().eq("id", goalId).select("id");
  if (error || !data?.length) throw new AppError("VALIDATION_FAILED", "Goals can't be changed at this stage");
  if (goal.is_primary) {
    // Primary goal removed: clear the mirror so READY stays blocked until the founder picks another.
    const service = requireService();
    await service.from("launches").update({ primary_goal_type: null, primary_goal_value: null }).eq("id", goal.launch_id);
  }
}

/**
 * C2: payment unlocks preparation. Opens Stripe Checkout for the launch's locked price. The redirect
 * back is never proof of payment; only the verified webhook records it (services/billing.ts).
 */
export async function startCheckout(launchId: string, origin: string) {
  const { supabase, orgId, user } = await requireFounder();
  const { data: launch } = await supabase
    .from("launches")
    .select("id, organization_id, status, launch_type, price_amount, currency, apps(name)")
    .eq("id", launchId)
    .maybeSingle();
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");
  if (launch.status !== "LAUNCH_TYPE_SELECTED" || !launch.launch_type) throw new AppError("VALIDATION_FAILED", "Choose a format first");
  if (launch.price_amount == null || !launch.currency) throw new AppError("VALIDATION_FAILED", "This launch has no price yet");
  const { count } = await supabase.from("launch_payments").select("id", { count: "exact", head: true }).eq("launch_id", launchId).eq("status", "succeeded");
  if ((count ?? 0) > 0) throw new AppError("VALIDATION_FAILED", "This launch is already paid");

  const appRel = launch.apps as { name: string } | { name: string }[] | null;
  const appName = (Array.isArray(appRel) ? appRel[0]?.name : appRel?.name) ?? "your app";
  const format = LAUNCH_TYPE_LABELS[launch.launch_type as LaunchType];
  const orderId = randomUUID();
  const organizationId = launch.organization_id ?? orgId;
  const { checkoutUrl, providerSessionId } = await getProviders().billing.createLaunchCheckout({
    orderId,
    organizationId,
    launchId,
    launchType: launch.launch_type as LaunchType,
    amount: launch.price_amount,
    currency: launch.currency,
    productName: `AppDemo.live ${format}: ${appName}`,
    customerEmail: user.email ?? null,
    // Stripe fills in {CHECKOUT_SESSION_ID}; the success page only displays status, it never marks anything paid.
    successUrl: `${origin}/dashboard/launches/${launchId}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/dashboard/launches/${launchId}/checkout/cancel`,
  });

  // Founders can't write orders (RLS), so the pending row is created with the service client.
  const { error } = await requireService().from("launch_orders").insert({
    id: orderId,
    organization_id: organizationId,
    launch_id: launchId,
    stripe_session_id: providerSessionId,
    status: "pending",
    amount: launch.price_amount,
    currency: launch.currency,
  });
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "order_insert_failed", launchId, error: error.message }));
    throw new AppError("INTERNAL_ERROR", "Could not start checkout");
  }
  return { checkoutUrl, orderId };
}

export async function cancelLaunch(launchId: string) {
  await transitionLaunch({ launchId, to: "CANCELLED", actorKind: "founder", reason: "Cancelled by founder" });
}

export { applyTransition };

/** Reads one checkout order for the success page. RLS limits it to the founder's organization. */
export async function getCheckoutOrder(launchId: string, sessionId: string) {
  const { supabase } = await requireFounder();
  const { data, error } = await supabase
    .from("launch_orders")
    .select("id, status, amount, currency, created_at, paid_at")
    .eq("launch_id", launchId)
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", "Could not load order");
  if (!data) throw new AppError("NOT_FOUND", "Order not found");
  return data as { id: string; status: "pending" | "paid"; amount: number; currency: string; created_at: string; paid_at: string | null };
}
