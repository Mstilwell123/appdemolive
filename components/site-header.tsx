import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          AppDemo<span className="text-indigo-600">.live</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/#how-it-works" className="text-slate-600 hover:text-slate-900">How it works</Link>
          <Link href="/demo" className="text-slate-600 hover:text-slate-900">Demo</Link>
          <Link href="/pricing" className="text-slate-600 hover:text-slate-900">Pricing</Link>
          <Link href="/login" className="text-slate-600 hover:text-slate-900">Log in</Link>
          <Link href="/signup" className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700">
            Launch My App
          </Link>
        </nav>
      </div>
    </header>
  );
}
