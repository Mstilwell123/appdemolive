import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/** Placeholder for a legal page. Deliberately contains no legal terms: the real text needs legal review. */
export function LegalDraft({ title }: { title: string }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Draft — pending legal review</p>
        <h1 className="mt-6 text-3xl font-bold">{title}</h1>
        <p className="mt-4 text-slate-700">This page is a placeholder. The final {title.toLowerCase()} for AppDemo.live has not been published yet, and nothing on this page is a legal term or commitment.</p>
        <p className="mt-4 text-slate-700">Questions in the meantime: <a className="underline" href="mailto:support@pragvance.ai">support@pragvance.ai</a>.</p>
      </main>
      <SiteFooter />
    </>
  );
}
