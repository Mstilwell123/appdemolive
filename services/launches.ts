import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { experiments, launch_goals, launch_payments, launch_state_history, launches } from "@/db/schema";
import { AppError, fromDbError } from "@/domain/errors";
import { canTransition } from "@/domain/launch-state-machine";
import { computeNextAction } from "@/domain/next-action";
import { dbErrorMessage, queryRows, type Db } from "@/lib/db";
import { authorizeLaunch } from "@/services/session";
import type { ActorKind, LaunchStatus, LaunchType, NextAction } from "@/types/launch";

async function countPrimaryGoals(db: Db, launchId: string) {
  const [r] = await db.select({ n: count() }).from(launch_goals).where(and(eq(launch_goals.launch_id, launchId), eq(launch_goals.is_primary, true)));
  return r?.n ?? 0;
}
async function countPayments(db: Db, launchId: string) {
  const [r] = await db.select({ n: count() }).from(launch_payments).where(and(eq(launch_payments.launch_id, launchId), eq(launch_payments.status, "succeeded")));
  return r?.n ?? 0;
}

/** getLaunchNextAction (PRD §57). Only members of the launch's organization (or staff) can read it. */
export async function getLaunchNextAction(launchId: string): Promise<NextAction> {
  const { db } = await authorizeLaunch(launchId);
  const [launch] = await db
    .select({ id: launches.id, status: launches.status, app_id: launches.app_id, scheduled_at: launches.scheduled_at, primary_cta_id: launches.primary_cta_id })
    .from(launches)
    .where(eq(launches.id, launchId));
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");

  const [primaryGoals, payments] = await Promise.all([countPrimaryGoals(db, launchId), countPayments(db, launchId)]);

  let experimentAwaitingApproval = false;
  if (launch.status === "EXPERIMENTING") {
    const [r] = await db.select({ n: count() }).from(experiments).where(and(eq(experiments.launch_id, launchId), eq(experiments.status, "awaiting_approval")));
    experimentAwaitingApproval = (r?.n ?? 0) > 0;
  }

  return computeNextAction({
    launchId: launch.id,
    status: launch.status as LaunchStatus,
    appId: launch.app_id,
    scheduledAt: launch.scheduled_at,
    ctaConfigured: Boolean(launch.primary_cta_id),
    primaryGoalSet: primaryGoals === 1,
    paymentSucceeded: payments > 0,
    experimentAwaitingApproval,
  });
}

/**
 * Validates and applies one status change. Callers must already have authorized the actor.
 * transition_launch() re-validates, locks the row and writes history.
 */
export async function applyTransition(
  db: Db,
  input: { launchId: string; to: LaunchStatus; actorKind: ActorKind; actorId: string | null; reason?: string },
) {
  const [launch] = await db
    .select({ id: launches.id, status: launches.status, launch_type: launches.launch_type, scheduled_at: launches.scheduled_at })
    .from(launches)
    .where(eq(launches.id, input.launchId));
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");

  const [primaryGoalCount, paymentCount] = await Promise.all([countPrimaryGoals(db, launch.id), countPayments(db, launch.id)]);

  let resumeTo: LaunchStatus | null = null;
  if (launch.status === "PAUSED" || launch.status === "FAILED") {
    const [last] = await db
      .select({ from_status: launch_state_history.from_status })
      .from(launch_state_history)
      .where(and(eq(launch_state_history.launch_id, launch.id), eq(launch_state_history.to_status, launch.status)))
      .orderBy(desc(launch_state_history.created_at))
      .limit(1);
    resumeTo = (last?.from_status as LaunchStatus) ?? null;
  }

  const check = canTransition(launch.status as LaunchStatus, input.to, input.actorKind, {
    launchType: launch.launch_type as LaunchType | null,
    scheduledAt: launch.scheduled_at,
    primaryGoalCount,
    paymentSucceeded: paymentCount > 0,
    resumeTo,
  });
  if (!check.ok) throw check.error;

  try {
    const [row] = await queryRows<Record<string, unknown>>(
      db,
      sql`select * from public.transition_launch(${launch.id}::uuid, ${launch.status}, ${input.to}, ${input.actorId}::uuid, ${input.actorKind}, ${input.reason ?? null})`,
    );
    return row ?? null;
  } catch (e) {
    throw fromDbError(dbErrorMessage(e));
  }
}

/** Walks a launch through several statuses in order (each step validated). */
export async function applyTransitions(
  db: Db,
  launchId: string,
  steps: Array<{ to: LaunchStatus; actorKind: ActorKind; actorId: string | null; reason?: string }>,
) {
  for (const s of steps) await applyTransition(db, { launchId, ...s });
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
  const { db, user } = await authorizeLaunch(input.launchId, [input.actorKind]);
  return applyTransition(db, { ...input, actorId: user.id });
}
