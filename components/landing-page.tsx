import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DemoWalkthrough } from "@/components/demo-walkthrough";
import { ExampleCampaign, ExampleVideo, IllustrativeBadge } from "@/components/example-campaign";
import { DEFAULT_LAUNCH_PRICES } from "@/integrations/billing/mock";

/** Canonical public experience (PRD v1.4 §117): "/" is the example campaign; "/demo" renders the same page. */
const faqs = [
  { q: "Do I need to be a good presenter?", a: "No. You know your product best. We prepare the run-of-show and questions so you can simply show how it works." },
  { q: "What kind of software qualifies?", a: "SaaS, mobile and web apps, AI apps and agents, automation tools, APIs, plugins and developer tools that work today." },
  { q: "Is there public chat during my launch?", a: "No. Viewers submit questions privately and a moderator approves them, so spam and trolls never derail your launch." },
  { q: "Do you post to my social accounts?", a: "You approve and download your Launch Content Pack and post it yourself. We never ask for your social passwords." },
  { q: "What do you measure?", a: "Business outcomes, not just views: call-to-action responses, clicks, signups, trials, bookings and purchases where we can observe them." },
];


const deliverables = [
  "A prepared launch strategy and run-of-show",
  "A moderated live launch with private, approved viewer questions",
  "The full recording of your presentation",
  "About eight purposeful promotional videos",
  "Captions, hooks and calls to action for every video",
  "Posting suggestions and tracked links",
  "A launch results summary and the next recommended experiment",
];

const outcomes = ["Call-to-action responses", "DM intent", "Clicks", "Qualified leads", "Trials and signups", "Bookings", "Purchases and revenue"];

const fits = ["Your app works today and real people can use it", "You know who it's for and what you want them to do", "You want promo videos and a plan without becoming a video editor"];
const supplies = ["Your app and its facts: what it does, price, who it's for", "About 30 minutes to rehearse and record your demo", "Approval of each clip, and posting from your own accounts"];
const packageNotes: Record<string, string> = {
  founder_demo: "You present a 15-minute demo; we prepare, moderate and produce.",
  cohosted_launch: "A 30-minute show with a co-host asking what customers would ask.",
};

export function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">Live software launches</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">You built the app. We turn your demo into customers.</h1>
            <p className="mt-5 text-lg text-slate-600">
              Show us how it works once. We help you record it, cut it into promo videos you approve, give you a 14-day posting plan, and measure who actually signs up.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-md bg-indigo-600 px-6 py-3 text-lg font-semibold text-white hover:bg-indigo-700">Launch My App</Link>
              <a href="#example" className="rounded-md border border-slate-300 px-6 py-3 text-lg font-semibold text-slate-800 hover:bg-slate-50">Watch the Example</a>
            </div>
          </div>
          <div>
            <ExampleVideo src="source-demo" label="InvoicePilot example demo, illustrative, with captions" />
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"><IllustrativeBadge /> InvoicePilot is a fictional sample app. Sound is off until you choose to play.</p>
          </div>
        </section>

        <section id="example" className="scroll-mt-4 bg-slate-50 py-14 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-3xl font-bold">One complete example campaign</h2>
            <p className="mt-3 max-w-3xl text-slate-600">
              Follow InvoicePilot through all six steps, or jump to any step. Each shows what goes in, what comes out, and why it helps.
              The app is fictional, the media are illustrations, and the results are example data. Real launches are run with operator help, not instantly.
            </p>
            <div className="mt-8"><ExampleCampaign /></div>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="text-center text-3xl font-bold">Packages</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {DEFAULT_LAUNCH_PRICES.map((p) => (
              <div key={p.launchType} className="flex flex-col rounded-xl border border-slate-200 p-6">
                <h3 className="text-xl font-semibold">{p.label}</h3>
                <p className="mt-3 text-4xl font-bold">${(p.amount / 100).toLocaleString("en-US")}<span className="text-base font-normal text-slate-500"> per launch</span></p>
                <p className="mt-3 flex-1 text-sm text-slate-600">{packageNotes[p.launchType]}</p>
                <Link href="/pricing" className="mt-6 text-sm font-semibold text-indigo-700 hover:text-indigo-900">Compare what&apos;s included →</Link>
              </div>
            ))}
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div><h3 className="font-semibold">What you get</h3><ul className="mt-3 space-y-2 text-sm text-slate-600">{deliverables.map((d) => <li key={d}>✓ {d}</li>)}</ul></div>
            <div><h3 className="font-semibold">Who it fits</h3><ul className="mt-3 space-y-2 text-sm text-slate-600">{fits.map((d) => <li key={d}>• {d}</li>)}</ul></div>
            <div><h3 className="font-semibold">What you supply</h3><ul className="mt-3 space-y-2 text-sm text-slate-600">{supplies.map((d) => <li key={d}>• {d}</li>)}</ul></div>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-2">
            {outcomes.map((o) => <span key={o} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800">{o}</span>)}
          </div>
        </section>

        <section id="samples" className="border-t border-slate-200 py-14 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-center text-3xl font-bold">More sample launch plans</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">Fictional products. See the strategy, customer questions and run-of-show our AI prepares from a brief.</p>
            <DemoWalkthrough />
          </div>
        </section>

        <section id="faq" className="bg-slate-50 py-14 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="text-center text-3xl font-bold">FAQ</h2>
            <dl className="mt-10 space-y-6">
              {faqs.map((f) => (<div key={f.q}><dt className="font-semibold">{f.q}</dt><dd className="mt-1 text-slate-600">{f.a}</dd></div>))}
            </dl>
          </div>
        </section>

        <section className="bg-indigo-600 px-4 py-14 text-center text-white">
          <h2 className="text-3xl font-bold">Ready to show the world what you built?</h2>
          <Link href="/signup" className="mt-8 inline-block rounded-md bg-white px-8 py-4 text-lg font-semibold text-indigo-700 hover:bg-indigo-50">Launch My App</Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
