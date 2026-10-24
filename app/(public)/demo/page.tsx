import { SiteHeader } from "@/components/site-header";
import { DemoWalkthrough } from "@/components/demo-walkthrough";

export default function DemoPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section id="demo" className="py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h1 className="text-center text-3xl font-bold">Demo</h1>
            <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
              Pick a sample product and run it. You&apos;ll see the launch strategy, customer questions and run-of-show
              our AI prepares from a founder&apos;s brief.
            </p>
            <DemoWalkthrough />
          </div>
        </section>
      </main>
      <footer className="py-8 text-center text-sm text-slate-500">© 2026 Pragvance LLC</footer>
    </>
  );
}
