import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, notInArray, sql } from "drizzle-orm";
import {
  app_intakes, app_versions, apps, launch_goals, launch_orders, launch_participants, launch_payments, launch_prices,
  launch_state_history, launches, qualifications,
} from "@/db/schema";
import { AppError, fromDbError } from "@/domain/errors";
import { dbErrorMessage, type Db } from "@/lib/db";
import { getProviders } from "@/services/providers";
import { applyTransition, applyTransitions, transitionLaunch } from "@/services/launches";
import { requireFounder } from "@/services/session";
import type { LaunchStatus, LaunchType } from "@/types/launch";

const LAUNCH_TYPE_LABELS: Record<LaunchType, string> = { founder_demo: "Founder Demo", cohosted_launch: "Co-Hosted Launch Show" };

const ACTIVE_EXCLUDED: LaunchStatus[] = ["COMPLETED", "CANCELLED"];
/** Goals are frozen once a launch is READY or later (was a database policy under Supabase). */
const GOALS_LOCKED: LaunchStatus[] = ["READY", "LIVE", "COMPLETED", "CANCELLED"];

/** The founder's launch, or NOT_FOUND when it belongs to another organization. */
async function ownLaunch(db: Db, orgId: string, launchId: string) {
  const [launch] = await db
    .select({ id: launches.id, organization_id: launches.organization_id, status: launches.status })
    .from(launches)
    .where(and(eq(launches.id, launchId), eq(launches.organization_id, orgId)));
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");
  return launch;
}

/**
 * §6: a launch belongs to the organization, founder, app and the app's latest version. It starts
 * as DRAFT and is moved forward to match where that version already is in intake and review.
 */
export async function createLaunch(appId: string): Promise<string> {
  const { db, user, orgId } = await requireFounder();

  const [app] = await db.select({ id: apps.id, organization_id: apps.organization_id }).from(apps).where(and(eq(apps.id, appId), eq(apps.organization_id, orgId)));
  if (!app) throw new AppError("NOT_FOUND", "App not found");

  const [existing] = await db
    .select({ id: launches.id })
    .from(launches)
    .where(and(eq(launches.app_id, appId), eq(launches.organization_id, orgId), notInArray(launches.status, ACTIVE_EXCLUDED)))
    .limit(1);
  if (existing) return existing.id; // one open launch per app; a double click lands on the same launch

  const [version] = await db
    .select({ id: app_versions.id })
    .from(app_versions)
    .where(eq(app_versions.app_id, appId))
    .orderBy(desc(app_versions.version_number))
    .limit(1);
  if (!version) throw new AppError("NOT_FOUND", "App version not found");

  const [[intake], [qualification]] = await Promise.all([
    db.select({ status: app_intakes.status }).from(app_intakes).where(eq(app_intakes.app_version_id, version.id)).orderBy(desc(app_intakes.created_at)).limit(1),
    db
      .select({ id: qualifications.id, status: qualifications.status, reviewer_id: qualifications.reviewer_id, launch_id: qualifications.launch_id })
      .from(qualifications)
      .where(eq(qualifications.app_version_id, version.id))
      .orderBy(desc(qualifications.created_at))
      .limit(1),
  ]);
  if (qualification?.status === "rejected") {
    throw new AppError("QUALIFICATION_REQUIRED", "This version wasn't approved for launch. Start a new version to try again.");
  }

  let launchId: string;
  try {
    const [row] = await db
      .insert(launches)
      .values({ organization_id: app.organization_id, app_id: appId, app_version_id: version.id, created_by: user.id })
      .returning({ id: launches.id });
    launchId = row.id;
  } catch {
    throw new AppError("INTERNAL_ERROR", "Could not create the launch");
  }

  await db
    .insert(launch_participants)
    .values({ organization_id: orgId, launch_id: launchId, user_id: user.id, role: "founder", status: "confirmed", created_by: user.id });

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
  await applyTransitions(db, launchId, steps);
  if (qualification && ["pending", "in_review"].includes(qualification.status) && !qualification.launch_id) {
    await db.update(qualifications).set({ launch_id: launchId }).where(eq(qualifications.id, qualification.id));
  }
  return launchId;
}

export async function listLaunches() {
  const { db, orgId } = await requireFounder();
  const rows = await db
    .select({
      id: launches.id, status: launches.status, launch_type: launches.launch_type, price_amount: launches.price_amount, currency: launches.currency,
      scheduled_at: launches.scheduled_at, primary_goal_type: launches.primary_goal_type, created_at: launches.created_at,
      app_name: apps.name, version_label: app_versions.version_label,
    })
    .from(launches)
    .leftJoin(apps, eq(apps.id, launches.app_id))
    .leftJoin(app_versions, eq(app_versions.id, launches.app_version_id))
    .where(eq(launches.organization_id, orgId))
    .orderBy(desc(launches.created_at));
  return rows.map(({ app_name, version_label, ...r }) => ({
    ...r,
    apps: app_name == null ? null : { name: app_name },
    app_versions: version_label == null ? null : { version_label },
  }));
}

export async function getLaunchDetail(launchId: string) {
  const { db, orgId } = await requireFounder();
  const [row] = await db
    .select({
      launch: launches,
      app: { id: apps.id, name: apps.name, website_url: apps.website_url },
      version: { id: app_versions.id, version_label: app_versions.version_label, version_number: app_versions.version_number },
    })
    .from(launches)
    .innerJoin(apps, eq(apps.id, launches.app_id))
    .leftJoin(app_versions, eq(app_versions.id, launches.app_version_id))
    .where(and(eq(launches.id, launchId), eq(launches.organization_id, orgId)));
  if (!row) throw new AppError("NOT_FOUND", "Launch not found");
  const launch = { ...row.launch, apps: row.app, app_versions: row.version };

  const [goals, participants, history, prices, payments] = await Promise.all([
    db
      .select({ id: launch_goals.id, goal_type: launch_goals.goal_type, is_primary: launch_goals.is_primary, target_value: launch_goals.target_value, destination_url: launch_goals.destination_url, created_at: launch_goals.created_at })
      .from(launch_goals)
      .where(eq(launch_goals.launch_id, launchId))
      .orderBy(asc(launch_goals.created_at)),
    db
      .select({ id: launch_participants.id, role: launch_participants.role, status: launch_participants.status, external_name: launch_participants.external_name, user_id: launch_participants.user_id })
      .from(launch_participants)
      .where(eq(launch_participants.launch_id, launchId))
      .orderBy(asc(launch_participants.created_at)),
    db
      .select({ id: launch_state_history.id, from_status: launch_state_history.from_status, to_status: launch_state_history.to_status, actor_kind: launch_state_history.actor_kind, reason: launch_state_history.reason, created_at: launch_state_history.created_at })
      .from(launch_state_history)
      .where(eq(launch_state_history.launch_id, launchId))
      .orderBy(desc(launch_state_history.created_at)),
    db.select({ launch_type: launch_prices.launch_type, amount: launch_prices.amount, currency: launch_prices.currency }).from(launch_prices).orderBy(asc(launch_prices.amount)),
    db
      .select({ id: launch_payments.id, status: launch_payments.status, amount: launch_payments.amount, currency: launch_payments.currency, created_at: launch_payments.created_at })
      .from(launch_payments)
      .where(eq(launch_payments.launch_id, launchId)),
  ]);
  return { launch, goals, participants, history, prices, payments };
}

export async function updateLaunchDetails(
  launchId: string,
  d: { objective: string | null; audience: string | null; ctaText: string | null; dmKeyword: string | null; trackedDestinationUrl: string | null },
) {
  const { db, orgId } = await requireFounder();
  let updated: { id: string }[];
  try {
    updated = await db
      .update(launches)
      .set({ objective: d.objective, audience: d.audience, cta_text: d.ctaText, dm_keyword: d.dmKeyword, tracked_destination_url: d.trackedDestinationUrl })
      .where(and(eq(launches.id, launchId), eq(launches.organization_id, orgId), notInArray(launches.status, ["LIVE", "COMPLETED", "CANCELLED"])))
      .returning({ id: launches.id });
  } catch (e) {
    throw fromDbError(dbErrorMessage(e));
  }
  if (!updated.length) throw new AppError("NOT_FOUND", "Launch not found or can no longer be edited");
}

/** §6/§12: choosing a format snapshots its price (database trigger) and, from QUALIFIED, records the choice. */
export async function chooseLaunchType(launchId: string, launchType: LaunchType) {
  const { db, orgId } = await requireFounder();
  const launch = await ownLaunch(db, orgId, launchId);
  if (!["QUALIFIED", "LAUNCH_TYPE_SELECTED"].includes(launch.status)) {
    throw new AppError("QUALIFICATION_REQUIRED", "You can choose a format once your app is qualified");
  }
  try {
    await db.update(launches).set({ launch_type: launchType }).where(and(eq(launches.id, launchId), eq(launches.organization_id, orgId)));
  } catch (e) {
    throw fromDbError(dbErrorMessage(e));
  }
  if (launch.status === "QUALIFIED") await transitionLaunch({ launchId, to: "LAUNCH_TYPE_SELECTED", actorKind: "founder" });
}

export async function addGoal(launchId: string, g: { goalType: string; targetValue: number | null; destinationUrl: string | null }) {
  const { db, user, orgId } = await requireFounder();
  const launch = await ownLaunch(db, orgId, launchId);
  if (GOALS_LOCKED.includes(launch.status as LaunchStatus)) throw new AppError("VALIDATION_FAILED", "Goals can't be changed at this stage");
  const [{ n }] = await db.select({ n: count() }).from(launch_goals).where(eq(launch_goals.launch_id, launchId));
  let goalId: string;
  try {
    const [goal] = await db
      .insert(launch_goals)
      .values({
        organization_id: launch.organization_id, launch_id: launchId, goal_type: g.goalType,
        target_value: g.targetValue == null ? null : String(g.targetValue), destination_url: g.destinationUrl, created_by: user.id,
      })
      .returning({ id: launch_goals.id });
    goalId = goal.id;
  } catch {
    throw new AppError("VALIDATION_FAILED", "Goals can't be changed at this stage");
  }
  if (n === 0) await setPrimaryGoal(goalId); // the first goal is primary by default
}

/** The founder's goal on an editable launch, or an error. */
async function ownEditableGoal(db: Db, orgId: string, goalId: string) {
  const [goal] = await db
    .select({ id: launch_goals.id, launch_id: launch_goals.launch_id, is_primary: launch_goals.is_primary, launch_status: launches.status })
    .from(launch_goals)
    .innerJoin(launches, eq(launches.id, launch_goals.launch_id))
    .where(and(eq(launch_goals.id, goalId), eq(launch_goals.organization_id, orgId), eq(launches.organization_id, orgId)));
  if (!goal) throw new AppError("NOT_FOUND", "Goal not found");
  if (GOALS_LOCKED.includes(goal.launch_status as LaunchStatus)) throw new AppError("VALIDATION_FAILED", "Goals can't be changed at this stage");
  return goal;
}

export async function setPrimaryGoal(goalId: string) {
  const { db, orgId } = await requireFounder();
  await ownEditableGoal(db, orgId, goalId);
  try {
    await db.execute(sql`select public.set_primary_goal(${goalId}::uuid)`);
  } catch (e) {
    throw fromDbError(dbErrorMessage(e));
  }
}

export async function removeGoal(goalId: string) {
  const { db, orgId } = await requireFounder();
  const goal = await ownEditableGoal(db, orgId, goalId);
  const deleted = await db.delete(launch_goals).where(eq(launch_goals.id, goalId)).returning({ id: launch_goals.id });
  if (!deleted.length) throw new AppError("VALIDATION_FAILED", "Goals can't be changed at this stage");
  if (goal.is_primary) {
    // Primary goal removed: clear the mirror so READY stays blocked until the founder picks another.
    await db.update(launches).set({ primary_goal_type: null, primary_goal_value: null }).where(eq(launches.id, goal.launch_id));
  }
}

/**
 * C2: payment unlocks preparation. Opens Stripe Checkout for the launch's locked price. The redirect
 * back is never proof of payment; only the verified webhook records it (services/billing.ts).
 */
export async function startCheckout(launchId: string, origin: string) {
  const { db, orgId, user } = await requireFounder();
  const [launch] = await db
    .select({
      id: launches.id, organization_id: launches.organization_id, status: launches.status, launch_type: launches.launch_type,
      price_amount: launches.price_amount, currency: launches.currency, app_name: apps.name,
    })
    .from(launches)
    .leftJoin(apps, eq(apps.id, launches.app_id))
    .where(and(eq(launches.id, launchId), eq(launches.organization_id, orgId)));
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");
  if (launch.status !== "LAUNCH_TYPE_SELECTED" || !launch.launch_type) throw new AppError("VALIDATION_FAILED", "Choose a format first");
  if (launch.price_amount == null || !launch.currency) throw new AppError("VALIDATION_FAILED", "This launch has no price yet");
  const [{ n }] = await db.select({ n: count() }).from(launch_payments).where(and(eq(launch_payments.launch_id, launchId), eq(launch_payments.status, "succeeded")));
  if (n > 0) throw new AppError("VALIDATION_FAILED", "This launch is already paid");

  const appName = launch.app_name ?? "your app";
  const format = LAUNCH_TYPE_LABELS[launch.launch_type as LaunchType];
  const orderId = randomUUID();
  const { checkoutUrl, providerSessionId } = await getProviders().billing.createLaunchCheckout({
    orderId,
    organizationId: launch.organization_id,
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

  try {
    await db.insert(launch_orders).values({
      id: orderId,
      organization_id: launch.organization_id,
      launch_id: launchId,
      stripe_session_id: providerSessionId,
      status: "pending",
      amount: launch.price_amount,
      currency: launch.currency,
    });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "order_insert_failed", launchId, error: dbErrorMessage(e) }));
    throw new AppError("INTERNAL_ERROR", "Could not start checkout");
  }
  return { checkoutUrl, orderId };
}

export async function cancelLaunch(launchId: string) {
  await transitionLaunch({ launchId, to: "CANCELLED", actorKind: "founder", reason: "Cancelled by founder" });
}

export { applyTransition };

/** Reads one checkout order for the success page, limited to the founder's organization. */
export async function getCheckoutOrder(launchId: string, sessionId: string) {
  const { db, orgId } = await requireFounder();
  const [order] = await db
    .select({ id: launch_orders.id, status: launch_orders.status, amount: launch_orders.amount, currency: launch_orders.currency, created_at: launch_orders.created_at, paid_at: launch_orders.paid_at })
    .from(launch_orders)
    .where(and(eq(launch_orders.launch_id, launchId), eq(launch_orders.stripe_session_id, sessionId), eq(launch_orders.organization_id, orgId)));
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  return order as { id: string; status: "pending" | "paid"; amount: number; currency: string; created_at: string; paid_at: string | null };
}

