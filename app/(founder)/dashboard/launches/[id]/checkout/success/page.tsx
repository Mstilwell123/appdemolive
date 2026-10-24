import Link from "next/link";
import { LoadError, Panel, money, secondaryButtonClass, when } from "@/components/ui";
import { load } from "@/lib/page-load";
import { uuidSchema } from "@/schemas/launch";
import { getCheckoutOrder } from "@/services/launch-setup";

export const dynamic = "force-dynamic";

/** Shown after Stripe Checkout. It only displays the order; the verified webhook is what marks it paid. */
export default async function CheckoutSuccessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ session_id?: string }> }) {
  const { id } = await params;
  const { session_id: sessionId } = await searchParams;
  const back = `/dashboard/launches/${id}`;
  if (!uuidSchema.safeParse(id).success || !sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return <LoadError what="this checkout" />;
  }
  const self = `${back}/checkout/success?session_id=${sessionId}`;
  const order = await load(self, () => getCheckoutOrder(id, sessionId));
  if (!order) return <LoadError what="this checkout" />;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Panel title="Checkout">
        {order.status === "paid" ? (
          <div className="space-y-2">
            <p className="text-lg font-semibold text-emerald-800">Payment received. Thank you.</p>
            <p className="text-sm text-slate-600">{money(order.amount, order.currency)} paid {when(order.paid_at)}. Your launch has moved into preparation.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-lg font-semibold text-slate-900">Thanks! We&apos;re confirming your payment with Stripe.</p>
            <p className="text-sm text-slate-600">This usually takes a few seconds. Your launch stays on hold until Stripe confirms the {money(order.amount, order.currency)} payment.</p>
            <Link href={self} className="text-sm font-medium text-indigo-700 underline">Check again</Link>
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">Order {order.id}</p>
      </Panel>
      <Link href={`${back}#payment`} className={secondaryButtonClass}>Back to your launch</Link>
    </div>
  );
}
