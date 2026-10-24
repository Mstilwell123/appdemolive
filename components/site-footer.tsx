import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 px-4 py-8 text-sm text-slate-500">
      <nav aria-label="Footer" className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-6 gap-y-2">
        <Link href="/#example" className="hover:text-slate-800">Example campaign</Link>
        <Link href="/pricing" className="hover:text-slate-800">Pricing</Link>
        <Link href="/#faq" className="hover:text-slate-800">FAQ</Link>
        <Link href="/login" className="hover:text-slate-800">Log in</Link>
        <Link href="/privacy" className="hover:text-slate-800">Privacy (draft)</Link>
        <Link href="/terms" className="hover:text-slate-800">Terms (draft)</Link>
        <a href="mailto:support@pragvance.ai" className="hover:text-slate-800">Support</a>
      </nav>
      <p className="mt-4 text-center">© 2026 Pragvance LLC</p>
    </footer>
  );
}
