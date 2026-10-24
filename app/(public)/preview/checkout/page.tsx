import { createClient } from "@supabase/supabase-js";
import { DEFAULT_LAUNCH_PRICES } from "@/integrations/billing/mock";
import { env, isSupabaseConfigured } from "@/lib/env";
import type { PreviewPrice } from "@/domain/checkout-preview";
import type { LaunchType } from "@/types/launch";
import { CheckoutPreview } from "./checkout-preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout preview | AppDemo.live", robots: { index: false, follow: false } };

/** Prices come from the live launch_prices table (public read), so the preview shows the same saved price a launch snapshots. */
async function loadPrices(): Promise<{ prices: PreviewPrice[]; source: "database" | "defaults" }> {
  if (!isSupabaseConfigured()) return { prices: DEFAULT_LAUNCH_PRICES, source: "defaults" };
  try {
    const sb = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await sb.from("launch_prices").select("launch_type, amount, currency").eq("active", true);
    if (error || !data?.length) return { prices: DEFAULT_LAUNCH_PRICES, source: "defaults" };
    const labels = Object.fromEntries(DEFAULT_LAUNCH_PRICES.map((p) => [p.launchType, p.label]));
    const prices = data
      .map((r) => ({ launchType: r.launch_type as LaunchType, amount: r.amount, currency: r.currency, label: labels[r.launch_type] ?? r.launch_type }))
      .sort((a, b) => a.amount - b.amount);
    return { prices, source: "database" };
  } catch {
    return { prices: DEFAULT_LAUNCH_PRICES, source: "defaults" };
  }
}

export default async function CheckoutPreviewPage({ searchParams }: { searchParams: Promise<{ format?: string }> }) {
  const { format } = await searchParams;
  const { prices, source } = await loadPrices();
  const initial = prices.find((p) => p.launchType === format)?.launchType ?? prices[0]?.launchType ?? "founder_demo";
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Preview mode.</strong> No card is collected, no charge is made and nothing is saved. Real payment will go through Stripe once it&apos;s connected.
      </div>
      <CheckoutPreview prices={prices} initialFormat={initial} priceSource={source} />
    </main>
  );
}
