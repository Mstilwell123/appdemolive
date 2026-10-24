import { NextResponse } from "next/server";
import { AppError } from "@/domain/errors";
import { uuidSchema } from "@/schemas/launch";
import { startCheckout } from "@/services/launch-setup";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/launches/:id/checkout
 * Creates a Stripe Checkout Session for the launch's locked price and a pending order, then returns
 * the hosted checkout URL. Auth and launch ownership are checked server-side in startCheckout.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: "VALIDATION_FAILED", message: "Invalid launch id" }, { status: 422 });

  // Same-origin only: this route acts on the signed-in founder's cookies.
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!origin || !host || new URL(origin).host !== host) return NextResponse.json({ error: "FORBIDDEN", message: "Cross-site request" }, { status: 403 });

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? `${request.headers.get("x-forwarded-proto") ?? "http"}://${host}`;
  try {
    const { checkoutUrl, orderId } = await startCheckout(id, base);
    return NextResponse.json({ url: checkoutUrl, orderId });
  } catch (e) {
    if (e instanceof AppError) {
      const message = e.code === "INTERNAL_ERROR" ? "Something went wrong. Please try again." : e.message;
      return NextResponse.json({ error: e.code, message }, { status: e.httpStatus });
    }
    console.error(JSON.stringify({ level: "error", msg: "checkout_route_failed", launchId: id, error: (e as Error).message }));
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
