import type { LaunchType } from "@/types/launch";

/** BillingService contract (PRD §95–97). */
export interface LaunchPrice {
  launchType: LaunchType;
  amount: number; // minor units
  currency: string;
  label: string;
}

export interface BillingService {
  readonly name: string;
  getLaunchPrices(): Promise<LaunchPrice[]>;
  /** Returns a hosted checkout URL. A redirect back is never proof of payment; only the verified webhook is. */
  createLaunchCheckout(input: {
    /** App-generated order id; sent to Stripe as metadata.order_id and used as the idempotency key. */
    orderId: string;
    organizationId: string;
    launchId: string;
    launchType: LaunchType;
    /** The launch's locked price snapshot, in minor units. Stripe charges exactly this. */
    amount: number;
    currency: string;
    productName: string;
    customerEmail?: string | null;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutUrl: string; providerSessionId: string }>;
  /** Verifies the provider signature and returns a normalized event, or throws. */
  verifyWebhook(rawBody: string, signature: string | null): Promise<BillingEvent>;
}

export type BillingEvent =
  | { type: "payment.succeeded"; eventId: string; sessionId: string; orderId: string | null; launchId: string; organizationId: string; providerPaymentId: string; amount: number; currency: string }
  | { type: "payment.refunded"; eventId: string; providerPaymentId: string }
  | { type: "ignored"; eventId: string; reason: string };
