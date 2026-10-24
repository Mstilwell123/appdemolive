import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/domain/errors";
import type { BillingEvent } from "@/integrations/billing/types";
import { applyTransition } from "@/services/launches";
import { requireService } from "@/services/session";

const log = (level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown>) =>
  console[level](JSON.stringify({ level, msg, ...extra }));

/**
 * Applies a verified billing event. Safe to run more than once for the same event: the payment row
 * is keyed on the provider payment id, and the launch only moves forward if it is still waiting.
 */
export async function handleBillingEvent(event: BillingEvent, service: SupabaseClient = requireService()) {
  if (event.type === "ignored") {
    log("info", "billing_event_ignored", { eventId: event.eventId, reason: event.reason });
    return { outcome: "ignored" as const };
  }

  if (event.type === "payment.refunded") {
    const { error } = await service.from("launch_payments").update({ status: "refunded" }).eq("provider_payment_id", event.providerPaymentId);
    if (error) throw new AppError("INTERNAL_ERROR", "Could not record refund");
    log("info", "payment_refunded", { eventId: event.eventId, providerPaymentId: event.providerPaymentId });
    return { outcome: "refunded" as const }; // launch status is left to an operator (refund policy D5)
  }

  const { data: launch } = await service
    .from("launches")
    .select("id, organization_id, status, price_amount, currency")
    .eq("id", event.launchId)
    .maybeSingle();
  if (!launch || launch.organization_id !== event.organizationId) {
    log("error", "payment_for_unknown_launch", { eventId: event.eventId, launchId: event.launchId });
    return { outcome: "unknown_launch" as const };
  }
  if (launch.price_amount !== event.amount || launch.currency !== event.currency) {
    // Never unlock a launch for the wrong amount; an operator reconciles it in Stripe.
    log("error", "payment_amount_mismatch", { eventId: event.eventId, launchId: launch.id, expected: launch.price_amount, got: event.amount });
    return { outcome: "amount_mismatch" as const };
  }

  const { error: insertError } = await service
    .from("launch_payments")
    .upsert(
      {
        organization_id: launch.organization_id,
        launch_id: launch.id,
        provider: "stripe",
        provider_payment_id: event.providerPaymentId,
        amount: event.amount,
        currency: event.currency,
        status: "succeeded",
      },
      { onConflict: "provider_payment_id", ignoreDuplicates: true },
    );
  if (insertError) throw new AppError("INTERNAL_ERROR", "Could not record payment");

  // Flip the checkout order to paid. Only pending rows match, so a replayed event changes nothing.
  const { data: flipped, error: orderError } = await service
    .from("launch_orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("stripe_session_id", event.sessionId)
    .eq("launch_id", launch.id)
    .eq("status", "pending")
    .select("id");
  if (orderError) throw new AppError("INTERNAL_ERROR", "Could not mark order paid");
  if (flipped?.length) log("info", "order_paid", { eventId: event.eventId, orderId: flipped[0].id, sessionId: event.sessionId });
  else log("info", "order_already_paid_or_missing", { eventId: event.eventId, sessionId: event.sessionId });

  if (launch.status === "LAUNCH_TYPE_SELECTED") {
    await applyTransition(service, { launchId: launch.id, to: "PREPARATION", actorKind: "system", actorId: null, reason: "Payment confirmed by Stripe" });
    log("info", "launch_unlocked_by_payment", { eventId: event.eventId, launchId: launch.id });
    return { outcome: "unlocked" as const };
  }
  return { outcome: "recorded" as const };
}
