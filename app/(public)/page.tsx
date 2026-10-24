import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

const steps = [
  { title: "Submit your app", body: "Tell us what you built, who it's for and what you want viewers to do." },
  { title: "We prepare the launch", body: "We qualify your app and build your strategy, run-of-show and customer questions." },
  { title: "You demo it live", body: "You show how it works in a moderated live launch with a tracked call to action." },
  { title: "We make the promo content", body: "Your presentation becomes about eight purposeful promotional videos for you to approve and post." },
  { title: "We measure what converts", body: "We track clicks, signups and purchases, and propose the next experiment." },
];

const faqs = [
  { q: "Do I need to be a good presenter?", a: "No. You know your product best. We prepare the run-of-show and questions so you can simply show how it works." },
  { q: "What kind of software qualifies?", a: "SaaS, mobile and web apps, AI apps and agents, automation tools, APIs, plugins and developer tools that work today." },
  { q: "Is there public chat during my launch?", a: "No. Viewers submit questions privately and a moderator approves them, so spam and trolls never derail your launch." },
  { q: "Do you post to my social accounts?", a: "You approve and download your Launch Content Pack and post it yourself. We never ask for your social passwords." },
  { q: "What do you measure?", a: "Business outcomes, not just views: call-to-action responses, clicks, signups, trials, bookings and purchases where we can observe them." },
];


const cutKinds = [
  { name: "Hook", body: "The first seconds that make the right viewer stop scrolling." },
  { name: "Problem", body: "The pain your customer feels, in their words." },
  { name: "Demonstration", body: "Your app doing the job, start to finish." },
  { name: "Key feature", body: "The one capability that sets you apart." },
  { name: "Use case", body: "A specific customer getting a specific result." },
  { name: "Objection", body: "The doubt buyers have, answered live." },
  { name: "Founder story", body: "Why you built it, from you." },
  { name: "Outcome and CTA", body: "What changes for the customer, and exactly what to do next." },
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

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-6 py-24 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">Live software launches</p>
          <h1 className="mx-auto mt-4 max-w-3xl text-5xl font-bold tracking-tight">
            You built the app. Show us how it works. We&apos;ll turn it into customers.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            We prepare your launch, help you demonstrate it live, turn the presentation into promotional content, and
            measure what actually creates customers.
          </p>
          <Link href="/signup" className="mt-10 inline-block rounded-md bg-indigo-600 px-8 py-4 text-lg font-semibold text-white hover:bg-indigo-700">
            Launch My App
          </Link>
        </section>

        <section className="bg-slate-50 py-20">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <h2 className="text-3xl font-bold">What AppDemo does</h2>
            <p className="mt-4 text-lg text-slate-600">
              AppDemo runs the whole launch around you: qualification, preparation, a moderated live demo, promotional
              video cuts, and measurement of which messages and channels bring in real customers. Views are only a
              signal. We focus on clicks, signups and sales.
            </p>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold">How it works</h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-5">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-lg border border-slate-200 p-5">
                <span className="text-sm font-semibold text-indigo-600">Step {i + 1}</span>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="demo" className="border-t border-slate-200 py-20 text-center">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-3xl font-bold">See it in action</h2>
            <p className="mx-auto mt-4 max-w-2xl text-slate-600">
              Pick a sample product and run it. You&apos;ll see the launch strategy, customer questions and run-of-show
              our AI prepares from a founder&apos;s brief.
            </p>
            <Link href="/demo" className="mt-8 inline-block rounded-md bg-indigo-600 px-8 py-4 text-lg font-semibold text-white hover:bg-indigo-700">
              Try the demo
            </Link>
          </div>
        </section>


        <section id="examples" className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold">Examples</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
            Every launch is cut into promotional videos with a clear job each. These are the kinds of cuts we make from
            your presentation.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cutKinds.map((c) => (
              <div key={c.name} className="rounded-lg border border-slate-200 p-5">
                <h3 className="font-semibold">{c.name}</h3>
                <p className="mt-2 text-sm text-slate-600">{c.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-slate-500">Real launch examples will be shown here after our first launches go live.</p>
        </section>

        <section id="deliverables" className="bg-slate-50 py-20">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center text-3xl font-bold">What you get</h2>
            <p className="mt-4 text-center text-slate-600">
              Your Launch Content Pack arrives ready to approve, download and post. You never assemble anything yourself.
            </p>
            <ul className="mt-10 space-y-3">
              {deliverables.map((d) => (
                <li key={d} className="flex gap-3 rounded-lg bg-white p-4 shadow-sm">
                  <span className="font-bold text-indigo-600">✓</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="outcome" className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold">Outcome over exposure</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Views tell us what to fix. They aren&apos;t the goal. We judge a launch by what viewers do next.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {outcomes.map((o) => (
              <span key={o} className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-800">
                {o}
              </span>
            ))}
          </div>
        </section>

        <section id="faq" className="bg-slate-50 py-20">
          <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-3xl font-bold">FAQ</h2>
          <dl className="mt-10 space-y-6">
            {faqs.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold">{f.q}</dt>
                <dd className="mt-1 text-slate-600">{f.a}</dd>
              </div>
            ))}
          </dl>
          </div>
        </section>

        <section className="bg-indigo-600 py-16 text-center text-white">
          <h2 className="text-3xl font-bold">Ready to show the world what you built?</h2>
          <Link href="/signup" className="mt-8 inline-block rounded-md bg-white px-8 py-4 text-lg font-semibold text-indigo-700 hover:bg-indigo-50">
            Launch My App
          </Link>
        </section>
      </main>
      <footer className="py-8 text-center text-sm text-slate-500">© 2026 Pragvance LLC</footer>
    </>
  );
}
