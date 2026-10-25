import { LaunchStepsNav } from "@/components/launch-steps-nav";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LoadError, Panel, buttonClass, inputClass, secondaryButtonClass, when } from "@/components/ui";
import { CATEGORY_LABELS, KIND_LABELS, TRUTH_CATEGORIES, TRUTH_KINDS, hasEvidence, needsEvidence, type TruthItem, type TruthKind } from "@/domain/truth-sheet";
import { isDatabaseConfigured } from "@/lib/env";
import { AVAILABLE_STEPS } from "@/lib/launch-steps";
import { load } from "@/lib/page-load";
import { getTruthSheet } from "@/services/truth-sheet";
import { approveTruthSheetAction, saveTruthSheetAction, startTruthSheetAction } from "./actions";

export const dynamic = "force-dynamic";
const BLANK_ROWS = 3;
const KIND_STYLE: Record<TruthKind, string> = {
  confirmed: "bg-emerald-100 text-emerald-900", founder_reported: "bg-sky-100 text-sky-900",
  missing: "bg-amber-100 text-amber-900", suggestion: "bg-slate-100 text-slate-700",
};

export default async function UnderstandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; approved?: string }> }) {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error, saved, approved } = await searchParams;
  const data = await load(`/dashboard/launches/${id}/understand`, () => getTruthSheet(id));
  if (!data) return <LoadError what="this truth sheet" />;
  const { current, approved: approvedSheet, blockers } = data;
  const rows: Array<TruthItem | null> = [...(current?.items ?? []), ...Array<null>(BLANK_ROWS).fill(null)];

  return (
    <div className="space-y-6">
      <LaunchStepsNav launchId={id} current="understand" available={AVAILABLE_STEPS} />
      <div>
        <h1 className="text-3xl font-bold">Step 1: Understand</h1>
        <p className="mt-1 text-slate-600">Your product truth sheet. Every promotional claim is checked against it, so correct anything that isn&apos;t right before preparation.</p>
      </div>
      <ErrorBanner message={error} />
      {saved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Saved as a new version.</p>}
      {approved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Truth sheet approved.</p>}

      {!current ? (
        <Panel title="Start your truth sheet">
          <p className="text-slate-600">We&apos;ll start from what you told us in your intake. Anything AI suggests is marked as a suggestion, never as fact.</p>
          <form action={startTruthSheetAction} className="mt-3"><input type="hidden" name="launchId" value={id} /><button className={buttonClass}>Create my truth sheet</button></form>
        </Panel>
      ) : (
        <>
          <Panel title={`Version ${current.version} · ${current.status === "approved" ? "Approved" : "Draft"}`} highlight={current.status !== "approved"}>
            <p className="text-sm text-slate-600">
              {current.status === "approved" ? `Approved ${when(current.approved_at)}.` : approvedSheet ? `Version ${approvedSheet.version} stays approved until you approve this one.` : "Not approved yet."}
            </p>
            {blockers.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">Before you can approve:</p>
                <ul className="mt-1 list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              </div>
            ) : current.status !== "approved" && (
              <form action={approveTruthSheetAction} className="mt-3"><input type="hidden" name="launchId" value={id} /><button className={buttonClass}>Approve version {current.version}</button></form>
            )}
          </Panel>

          <Panel title="Edit the truth sheet">
            <p className="text-sm text-slate-600">Pricing, free trials, performance claims, testimonials and guarantees need evidence: a link or a note saying where it&apos;s shown. Without it, promotional copy that uses the claim can&apos;t be approved.</p>
            <form action={saveTruthSheetAction} className="mt-4 space-y-4">
              <input type="hidden" name="launchId" value={id} />
              <input type="hidden" name="rows" value={rows.length} />
              {rows.map((it, i) => {
                const flag = it && needsEvidence(it) && !hasEvidence(it);
                return (
                  <fieldset key={i} className={`rounded-lg border p-3 ${flag ? "border-amber-300" : "border-slate-200"}`}>
                    <legend className="px-1 text-xs text-slate-500">
                      {it ? <span className={`rounded-full px-2 py-0.5 ${KIND_STYLE[it.kind]}`}>{KIND_LABELS[it.kind]}</span> : "New line"}
                      {flag && <span className="ml-2 text-amber-800">Needs evidence</span>}
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-[10rem_10rem_1fr]">
                      <label className="text-xs text-slate-600">Topic
                        <select name={`item.${i}.category`} defaultValue={it?.category ?? "product"} className={inputClass}>
                          {TRUTH_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">Status
                        <select name={`item.${i}.kind`} defaultValue={it?.kind ?? "founder_reported"} className={inputClass}>
                          {TRUTH_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">Statement
                        <textarea name={`item.${i}.statement`} defaultValue={it?.statement ?? ""} rows={2} maxLength={1000} className={inputClass} />
                      </label>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="text-xs text-slate-600">Evidence link
                        <input name={`item.${i}.evidenceUrl`} type="url" defaultValue={it?.evidenceUrl ?? ""} placeholder="https://" className={inputClass} />
                      </label>
                      <label className="text-xs text-slate-600">Evidence note
                        <input name={`item.${i}.evidenceNote`} defaultValue={it?.evidenceNote ?? ""} maxLength={1000} className={inputClass} />
                      </label>
                    </div>
                    {it && <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name={`item.${i}.remove`} /> Remove this line</label>}
                  </fieldset>
                );
              })}
              <button className={secondaryButtonClass}>Save as version {current.version + 1}</button>
            </form>
          </Panel>
        </>
      )}
    </div>
  );
}
