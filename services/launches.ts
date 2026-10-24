import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, fromDbError } from "@/domain/errors";
import { canTransition } from "@/domain/launch-state-machine";
import { computeNextAction } from "@/domain/next-action";
import { getServiceClient, getUserClient } from "@/lib/supabase/server";
import type { ActorKind, LaunchStatus, LaunchType, NextAction } from "@/types/launch";

/**
 * getLaunchNextAction (PRD §57). Reads through the user's client, so RLS guarantees the caller
 * can only see launches in their own organization.
 */
export async function getLaunchNextAction(launchId: string): Promise<NextAction> {
  const supabase = await getUserClient();
  if (!supabase) throw new AppError("PROVIDER_UNAVAILABLE", "Supabase is not configured");

  const { data: launch, error } = await supabase
    .from("launches")
    .select("id, status, app_id, scheduled_at, primary_cta_id")
    .eq("id", launchId)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", "Could not load launch");
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");

  const [{ count: primaryGoals }, { count: payments }] = await Promise.all([
    supabase.from("launch_goals").select("id", { count: "exact", head: true }).eq("launch_id", launchId).eq("is_primary", true),
    supabase.from("launch_payments").select("id", { count: "exact", head: true }).eq("launch_id", launchId).eq("status", "succeeded"),
  ]);

  let experimentAwaitingApproval = false;
  if (launch.status === "EXPERIMENTING") {
    const { count } = await supabase
      .from("experiments")
      .select("id", { count: "exact", head: true })
      .eq("launch_id", launchId)
      .eq("status", "awaiting_approval");
    experimentAwaitingApproval = (count ?? 0) > 0;
  }

  return computeNextAction({
    launchId: launch.id,
    status: launch.status as LaunchStatus,
    appId: launch.app_id,
    scheduledAt: launch.scheduled_at,
    ctaConfigured: Boolean(launch.primary_cta_id),
    primaryGoalSet: (primaryGoals ?? 0) === 1,
    paymentSucceeded: (payments ?? 0) > 0,
    experimentAwaitingApproval,
  });
}

/**
 * Validates and applies one status change with the service client. Callers must already have
 * authorized the actor. transition_launch() re-validates, locks the row and writes history.
 */
export async function applyTransition(
  service: SupabaseClient,
  input: { launchId: string; to: LaunchStatus; actorKind: ActorKind; actorId: string | null; reason?: string },
) {
  const { data: launch } = await service
    .from("launches")
    .select("id, status, launch_type, scheduled_at")
    .eq("id", input.launchId)
    .maybeSingle();
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");

  const [{ count: primaryGoalCount }, { count: paymentCount }] = await Promise.all([
    service.from("launch_goals").select("id", { count: "exact", head: true }).eq("launch_id", launch.id).eq("is_primary", true),
    service.from("launch_payments").select("id", { count: "exact", head: true }).eq("launch_id", launch.id).eq("status", "succeeded"),
  ]);

  let resumeTo: LaunchStatus | null = null;
  if (launch.status === "PAUSED" || launch.status === "FAILED") {
    const { data: last } = await service
      .from("launch_state_history")
      .select("from_status")
      .eq("launch_id", launch.id)
      .eq("to_status", launch.status)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    resumeTo = (last?.from_status as LaunchStatus) ?? null;
  }

  const check = canTransition(launch.status as LaunchStatus, input.to, input.actorKind, {
    launchType: launch.launch_type as LaunchType | null,
    scheduledAt: launch.scheduled_at,
    primaryGoalCount: primaryGoalCount ?? 0,
    paymentSucceeded: (paymentCount ?? 0) > 0,
    resumeTo,
  });
  if (!check.ok) throw check.error;

  const { data, error } = await service.rpc("transition_launch", {
    p_launch_id: launch.id,
    p_expected_from: launch.status,
    p_to: input.to,
    p_actor_id: input.actorId,
    p_actor_kind: input.actorKind,
    p_reason: input.reason ?? null,
  });
  if (error) throw fromDbError(error.message);
  return data;
}

/** Walks a launch through several statuses in order (each step validated). */
export async function applyTransitions(
  service: SupabaseClient,
  launchId: string,
  steps: Array<{ to: LaunchStatus; actorKind: ActorKind; actorId: string | null; reason?: string }>,
) {
  for (const s of steps) await applyTransition(service, { launchId, ...s });
}

/**
 * The only way a signed-in person changes a launch's status. Authorizes the caller as a member
 * of the launch's organization (founder) or as platform staff (operator), then applies it.
 */
export async function transitionLaunch(input: {
  launchId: string;
  to: LaunchStatus;
  actorKind: Exclude<ActorKind, "system">;
  reason?: string;
}) {
  const userClient = await getUserClient();
  const service = getServiceClient();
  if (!userClient || !service) throw new AppError("PROVIDER_UNAVAILABLE", "Supabase is not configured");

  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) throw new AppError("UNAUTHORIZED", "Sign in required");

  const { data: launch } = await service.from("launches").select("id, organization_id").eq("id", input.launchId).maybeSingle();
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");

  if (input.actorKind === "founder") {
    const { data: member } = await service
      .from("organization_members")
      .select("id")
      .eq("organization_id", launch.organization_id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (!member) throw new AppError("NOT_FOUND", "Launch not found"); // don't reveal other tenants' launches
  } else {
    const { data: staff } = await service.from("platform_staff").select("role").eq("user_id", auth.user.id).maybeSingle();
    if (!staff || !["admin", "operator"].includes(staff.role)) throw new AppError("FORBIDDEN", "Operator access required");
  }

  return applyTransition(service, { ...input, actorId: auth.user.id });
}
