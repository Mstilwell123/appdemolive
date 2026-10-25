import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DEFAULT_LAUNCH_PRICES } from "@/integrations/billing/mock";

const details: Record<string, string[]> = {
  founder_demo: [
    "15-minute founder-led presentation",
    "Launch preparation and run-of-show",
    "Moderated live questions",
    "Recording and about 8 promotional cuts",
    "Analytics and conversion tracking",
  ],
  cohosted_launch: [
    "30-minute live launch show",
    "Professional co-host who asks what customers would ask",
    "Background moderator",
    "Recording and about 8 promotional cuts",
    "Analytics and conversion tracking",
  ],
};

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section id="pricing" className="bg-slate-50 py-20">
          <div className="mx-auto max-w-4xl px-6">
            <h1 className="text-center text-3xl font-bold">Pricing</h1>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {DEFAULT_LAUNCH_PRICES.map((p) => (
                <div key={p.launchType} className="flex flex-col rounded-xl border border-slate-200 bg-white p-8">
                  <h2 className="text-xl font-semibold">{p.label}</h2>
                  <p className="mt-4 text-4xl font-bold">
                    ${(p.amount / 100).toLocaleString("en-US")}
                    <span className="text-base font-normal text-slate-500"> per launch</span>
                  </p>
                  <ul className="mt-6 flex-1 space-y-2 text-sm text-slate-600">
                    {details[p.launchType].map((d) => (
                      <li key={d}>• {d}</li>
                    ))}
                  </ul>
                  <Link href="/signup" className="mt-8 rounded-md bg-indigo-600 px-4 py-3 text-center font-semibold text-white hover:bg-indigo-700">
                    Launch My App
                  </Link>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-sm text-slate-500">You can upgrade from Founder Demo to the Co-Hosted Launch Show before your production cutoff.</p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
