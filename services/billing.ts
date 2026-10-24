import "server-only";
import { and, eq } from "drizzle-orm";
import { launch_orders, launch_payments, launches } from "@/db/schema";
import { AppError } from "@/domain/errors";
import type { BillingEvent } from "@/integrations/billing/types";
import { requireDb, type Db } from "@/lib/db";
import { applyTransition } from "@/services/launches";

const log = (level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown>) =>
  console[level](JSON.stringify({ level, msg, ...extra }));

/**
 * Applies a verified billing event. Safe to run more than once for the same event: the payment row
 * is keyed on the provider payment id, and the launch only moves forward if it is still waiting.
 */
export async function handleBillingEvent(event: BillingEvent, db: Db = requireDb()) {
  if (event.type === "ignored") {
    log("info", "billing_event_ignored", { eventId: event.eventId, reason: event.reason });
    return { outcome: "ignored" as const };
  }

  if (event.type === "payment.refunded") {
    try {
      await db.update(launch_payments).set({ status: "refunded" }).where(eq(launch_payments.provider_payment_id, event.providerPaymentId));
    } catch {
      throw new AppError("INTERNAL_ERROR", "Could not record refund");
    }
    log("info", "payment_refunded", { eventId: event.eventId, providerPaymentId: event.providerPaymentId });
    return { outcome: "refunded" as const }; // launch status is left to an operator (refund policy D5)
  }

  const [launch] = await db
    .select({ id: launches.id, organization_id: launches.organization_id, status: launches.status, price_amount: launches.price_amount, currency: launches.currency })
    .from(launches)
    .where(eq(launches.id, event.launchId));
  if (!launch || launch.organization_id !== event.organizationId) {
    log("error", "payment_for_unknown_launch", { eventId: event.eventId, launchId: event.launchId });
    return { outcome: "unknown_launch" as const };
  }
  if (launch.price_amount !== event.amount || launch.currency !== event.currency) {
    // Never unlock a launch for the wrong amount; an operator reconciles it in Stripe.
    log("error", "payment_amount_mismatch", { eventId: event.eventId, launchId: launch.id, expected: launch.price_amount, got: event.amount });
    return { outcome: "amount_mismatch" as const };
  }

  let flipped: { id: string }[];
  try {
    await db
      .insert(launch_payments)
      .values({
        organization_id: launch.organization_id,
        launch_id: launch.id,
        provider: "stripe",
        provider_payment_id: event.providerPaymentId,
        amount: event.amount,
        currency: event.currency,
        status: "succeeded",
      })
      .onConflictDoNothing({ target: launch_payments.provider_payment_id });
  } catch {
    throw new AppError("INTERNAL_ERROR", "Could not record payment");
  }
  try {
    // Flip the checkout order to paid. Only pending rows match, so a replayed event changes nothing.
    flipped = await db
      .update(launch_orders)
      .set({ status: "paid", paid_at: new Date().toISOString() })
      .where(and(eq(launch_orders.stripe_session_id, event.sessionId), eq(launch_orders.launch_id, launch.id), eq(launch_orders.status, "pending")))
      .returning({ id: launch_orders.id });
  } catch {
    throw new AppError("INTERNAL_ERROR", "Could not mark order paid");
  }
  if (flipped.length) log("info", "order_paid", { eventId: event.eventId, orderId: flipped[0].id, sessionId: event.sessionId });
  else log("info", "order_already_paid_or_missing", { eventId: event.eventId, sessionId: event.sessionId });

  if (launch.status === "LAUNCH_TYPE_SELECTED") {
    await applyTransition(db, { launchId: launch.id, to: "PREPARATION", actorKind: "system", actorId: null, reason: "Payment confirmed by Stripe" });
    log("info", "launch_unlocked_by_payment", { eventId: event.eventId, launchId: launch.id });
    return { outcome: "unlocked" as const };
  }
  return { outcome: "recorded" as const };
}
