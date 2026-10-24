import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-sm font-semibold text-indigo-600">404</p>
        <h1 className="mt-2 text-3xl font-bold">We couldn&apos;t find that page</h1>
        <p className="mt-3 text-slate-600">The link may be old or mistyped. Here are some places to go instead.</p>
        <ul className="mt-8 flex flex-wrap justify-center gap-3">
          <li><Link href="/" className="inline-block rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700">Home</Link></li>
          <li><Link href="/#example" className="inline-block rounded-md border border-slate-300 px-4 py-2 font-semibold">Watch the Example</Link></li>
          <li><Link href="/pricing" className="inline-block rounded-md border border-slate-300 px-4 py-2 font-semibold">Pricing</Link></li>
          <li><Link href="/dashboard" className="inline-block rounded-md border border-slate-300 px-4 py-2 font-semibold">Dashboard</Link></li>
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
