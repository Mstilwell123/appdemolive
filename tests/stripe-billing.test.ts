import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import Stripe from "stripe";
import { createStripeBillingService, normalizeStripeEvent } from "@/integrations/billing/stripe";

const WHSEC = "whsec_test_unit";
const stripe = new Stripe("sk_test_unit");
const session = (over: Record<string, unknown> = {}) => ({
  id: "evt_1",
  type: "checkout.session.completed",
  data: {
    object: {
      object: "checkout.session", id: "cs_test_1", mode: "payment", payment_status: "paid", amount_total: 49900, currency: "usd",
      payment_intent: "pi_123", client_reference_id: "launch-1",
      metadata: { order_id: "order-1", launch_id: "launch-1", organization_id: "org-1", launch_type: "founder_demo" }, ...over,
    },
  },
});

describe("Stripe billing adapter", () => {
  it("turns a paid checkout into payment.succeeded with the launch and amount", () => {
    expect(normalizeStripeEvent(session() as unknown as Stripe.Event)).toEqual({
      type: "payment.succeeded", eventId: "evt_1", sessionId: "cs_test_1", orderId: "order-1", launchId: "launch-1", organizationId: "org-1", providerPaymentId: "pi_123", amount: 49900, currency: "usd",
    });
  });

  it("ignores unpaid sessions, missing metadata and unrelated events", () => {
    expect(normalizeStripeEvent(session({ payment_status: "unpaid" }) as unknown as Stripe.Event).type).toBe("ignored");
    expect(normalizeStripeEvent(session({ metadata: {} }) as unknown as Stripe.Event).type).toBe("ignored");
    expect(normalizeStripeEvent({ id: "evt_2", type: "customer.created", data: { object: {} } } as unknown as Stripe.Event).type).toBe("ignored");
  });

  it("maps a full refund to payment.refunded", () => {
    const e = { id: "evt_3", type: "charge.refunded", data: { object: { refunded: true, payment_intent: "pi_123" } } };
    expect(normalizeStripeEvent(e as unknown as Stripe.Event)).toEqual({ type: "payment.refunded", eventId: "evt_3", providerPaymentId: "pi_123" });
  });

  it("accepts only correctly signed webhooks", async () => {
    const billing = createStripeBillingService("sk_test_unit", WHSEC);
    const body = JSON.stringify(session());
    const good = stripe.webhooks.generateTestHeaderString({ payload: body, secret: WHSEC });
    const bad = stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_wrong" });
    await expect(billing.verifyWebhook(body, good)).resolves.toMatchObject({ type: "payment.succeeded", amount: 49900 });
    await expect(billing.verifyWebhook(body, bad)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(billing.verifyWebhook(body, null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(billing.verifyWebhook(body.replace("49900", "100"), good)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses webhooks when no signing secret is configured", async () => {
    await expect(createStripeBillingService("sk_test_unit", null).verifyWebhook("{}", "t=1,v1=x")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
