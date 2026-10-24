import "server-only";
import Stripe from "stripe";
import { AppError } from "@/domain/errors";
import { DEFAULT_LAUNCH_PRICES } from "./mock";
import type { BillingEvent, BillingService } from "./types";

/**
 * Stripe Checkout (one-time payment) adapter. Charges the launch's locked price snapshot with
 * inline price data, so Stripe never needs its own Price objects. Only the signed webhook is
 * treated as proof of payment (PRD §96).
 */
export function createStripeBillingService(secretKey: string, webhookSecret: string | null): BillingService {
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2 });

  return {
    name: secretKey.startsWith("sk_live_") ? "stripe-live" : "stripe-test",

    async getLaunchPrices() {
      return DEFAULT_LAUNCH_PRICES; // the database launch_prices table stays the source for snapshots
    },

    async createLaunchCheckout(input) {
      const metadata = { order_id: input.orderId, launch_id: input.launchId, organization_id: input.organizationId, launch_type: input.launchType };
      try {
        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            client_reference_id: input.launchId,
            customer_email: input.customerEmail ?? undefined,
            line_items: [
              {
                quantity: 1,
                price_data: { currency: input.currency, unit_amount: input.amount, product_data: { name: input.productName } },
              },
            ],
            metadata,
            payment_intent_data: { metadata },
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
          },
          // One session per order: a retried request for the same order returns the same session.
          { idempotencyKey: `launch-checkout:${input.orderId}` },
        );
        if (!session.url) throw new Error("Stripe returned no checkout URL");
        return { checkoutUrl: session.url, providerSessionId: session.id };
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "stripe_checkout_failed", launchId: input.launchId, error: (e as Error).message }));
        throw new AppError("PROVIDER_UNAVAILABLE", "We couldn't open checkout. Please try again in a minute.");
      }
    },

    async verifyWebhook(rawBody, signature): Promise<BillingEvent> {
      if (!webhookSecret) throw new AppError("PROVIDER_UNAVAILABLE", "Stripe webhook secret is not configured");
      if (!signature) throw new AppError("UNAUTHORIZED", "Missing Stripe signature");
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch {
        throw new AppError("UNAUTHORIZED", "Invalid Stripe signature");
      }
      return normalizeStripeEvent(event);
    },
  };
}

/** Maps a verified Stripe event to the app's billing event. Exported for tests. */
export function normalizeStripeEvent(event: Stripe.Event): BillingEvent {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode !== "payment" || s.payment_status !== "paid") return { type: "ignored", eventId: event.id, reason: `payment_status ${s.payment_status}` };
      const launchId = s.metadata?.launch_id ?? s.client_reference_id;
      const organizationId = s.metadata?.organization_id;
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      if (!launchId || !organizationId || !pi || s.amount_total == null || !s.currency) {
        return { type: "ignored", eventId: event.id, reason: "missing launch metadata" };
      }
      return {
        type: "payment.succeeded", eventId: event.id, sessionId: s.id, orderId: s.metadata?.order_id ?? null,
        launchId, organizationId, providerPaymentId: pi, amount: s.amount_total, currency: s.currency,
      };
    }
    case "charge.refunded": {
      const c = event.data.object as Stripe.Charge;
      const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
      if (!pi || !c.refunded) return { type: "ignored", eventId: event.id, reason: "partial or unlinked refund" };
      return { type: "payment.refunded", eventId: event.id, providerPaymentId: pi };
    }
    default:
      return { type: "ignored", eventId: event.id, reason: `unhandled ${event.type}` };
  }
}
