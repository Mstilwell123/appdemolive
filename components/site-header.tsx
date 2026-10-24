import Link from "next/link";

const links = [
  { href: "/#example", label: "Example" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/login", label: "Log in" },
];

/** Responsive header: inline links from sm up, a native <details> menu on phones (no sideways scroll at 320px). */
export function SiteHeader() {
  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="shrink-0 text-lg font-bold tracking-tight">
          AppDemo<span className="text-indigo-600">.live</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-6 text-sm sm:flex">
          {links.map((l) => <Link key={l.href} href={l.href} className="text-slate-600 hover:text-slate-900">{l.label}</Link>)}
          <Link href="/signup" className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700">Launch My App</Link>
        </nav>
        <details className="relative sm:hidden">
          <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">Menu</summary>
          <nav aria-label="Main" className="absolute right-0 z-20 mt-2 flex w-48 flex-col rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-lg">
            {links.map((l) => <Link key={l.href} href={l.href} className="rounded px-3 py-2 text-slate-700 hover:bg-slate-50">{l.label}</Link>)}
            <Link href="/signup" className="mt-1 rounded bg-indigo-600 px-3 py-2 text-center font-medium text-white">Launch My App</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
