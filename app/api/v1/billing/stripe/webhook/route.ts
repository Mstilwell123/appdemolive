import { NextResponse } from "next/server";
import { AppError } from "@/domain/errors";
import { getProviders } from "@/services/providers";
import { handleBillingEvent } from "@/services/billing";

export const dynamic = "force-dynamic";

/** Stripe webhook (PRD §96). The raw body is verified against the signing secret before anything is written. */
export async function POST(request: Request) {
  const billing = getProviders().billing;
  if (billing.name === "mock") return NextResponse.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 503 });
  const raw = await request.text();
  try {
    const event = await billing.verifyWebhook(raw, request.headers.get("stripe-signature"));
    const result = await handleBillingEvent(event);
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAUTHORIZED") return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
    console.error(JSON.stringify({ level: "error", msg: "stripe_webhook_failed", error: (e as Error).message }));
    return NextResponse.json({ error: "PROCESSING_FAILED" }, { status: 500 }); // Stripe retries on 5xx
  }
}
