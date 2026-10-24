import Link from "next/link";
import { Panel, buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Stripe sends the founder here when they leave Checkout without paying. Nothing is charged. */
export default async function CheckoutCancelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Panel title="Checkout">
        <p className="text-lg font-semibold text-slate-900">Checkout was cancelled.</p>
        <p className="mt-2 text-sm text-slate-600">You haven&apos;t been charged. Your launch stays on hold until it&apos;s paid, and you can pay whenever you&apos;re ready.</p>
      </Panel>
      <Link href={`/dashboard/launches/${encodeURIComponent(id)}#payment`} className={buttonClass}>Back to payment</Link>
    </div>
  );
}
