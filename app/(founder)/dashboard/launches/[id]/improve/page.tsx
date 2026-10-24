import { LaunchStepsNav } from "@/components/launch-steps-nav";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LoadError, Panel, buttonClass } from "@/components/ui";
import { isDatabaseConfigured } from "@/lib/env";
import { AVAILABLE_STEPS } from "@/lib/launch-steps";
import { load } from "@/lib/page-load";
import { getImprove } from "@/services/experiments";
import { cancelExperimentAction, finishExperimentAction, recordResultsAction, startExperimentAction } from "./actions";

export const dynamic = "force-dynamic";

const DONE: Record<string, string> = { started: "Experiment started.", recorded: "Results saved to the hypothesis.", finished: "Experiment finished.", cancelled: "Experiment cancelled." };

export default async function ImprovePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error, done } = await searchParams;
  const data = await load(`/dashboard/launches/${id}/improve`, () => getImprove(id));
  if (!data) return <LoadError what="this launch's experiment" />;
  const exp = data.experiment;
  const open = exp && !["completed", "cancelled"].includes(exp.status);
  const linkLabel = (l: { slug: string; channel: string | null }) => `/r/${l.slug}${l.channel ? ` (${l.channel})` : ""}`;
  return (
    <div className="space-y-6">
      <LaunchStepsNav launchId={id} current="improve" available={AVAILABLE_STEPS} />
      <div>
        <h1 className="text-3xl font-bold">Step 6: Improve</h1>
        <p className="mt-1 text-slate-600">Test one idea at a time by comparing two tracked links. A hypothesis stays a hypothesis until the clicks support it.</p>
      </div>
      <ErrorBanner message={error} />
      {done && DONE[done] && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{DONE[done]}</p>}
      {exp && (
        <Panel title={open ? "Running experiment" : `Last experiment (${exp.status})`}>
          <p className="text-sm"><span className="font-semibold">Hypothesis:</span> {exp.hypothesis?.statement ?? "—"} <span className="text-slate-500">({exp.hypothesis?.status ?? "none"})</span></p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {[exp.control, exp.variant].map((v) => (
              <div key={v.label} className="rounded-lg border border-slate-200 p-3"><dt className="text-xs text-slate-500">{v.label}</dt><dd className="text-2xl font-bold">{v.clicks} <span className="text-sm font-normal text-slate-500">clicks</span></dd></div>
            ))}
          </dl>
          <p className={`mt-3 text-sm ${exp.verdict.kind === "winner" ? "font-semibold text-emerald-800" : "text-slate-700"}`}>{exp.verdict.text}</p>
          {exp.hypothesis?.evidence_summary && <p className="mt-2 text-xs text-slate-500">Saved evidence: {exp.hypothesis.evidence_summary}</p>}
          {open && (
            <div className="mt-4 flex flex-wrap gap-2">
              <form action={recordResultsAction}><input type="hidden" name="launchId" value={id} /><button className={buttonClass}>Save current results</button></form>
              {exp.verdict.kind !== "insufficient_data" && <form action={finishExperimentAction}><input type="hidden" name="launchId" value={id} /><button className={buttonClass}>Finish experiment</button></form>}
              <form action={cancelExperimentAction}><input type="hidden" name="launchId" value={id} /><button className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button></form>
            </div>
          )}
        </Panel>
      )}
      {!open && (
        <Panel title="Start an experiment">
          {data.links.length < 2 ? <p className="text-sm text-slate-600">You need at least two tracked links. Create them on the Measure step.</p> : (
            <form action={startExperimentAction} className="space-y-3">
              <input type="hidden" name="launchId" value={id} />
              <label className="block text-sm font-medium">What do you expect?
                <textarea name="statement" required minLength={10} maxLength={500} className="mt-1 block w-full rounded border border-slate-300 p-2" placeholder="The variant link's hook will draw more clicks than the control" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["controlLinkId", "variantLinkId"] as const).map((n, i) => (
                  <label key={n} className="block text-sm font-medium">{i ? "Variant link" : "Control link"}
                    <select name={n} defaultValue={data.links[i]?.id} className="mt-1 block w-full rounded border border-slate-300 p-2">
                      {data.links.map((l) => <option key={l.id} value={l.id}>{linkLabel(l)}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <button className={buttonClass}>Start experiment</button>
            </form>
          )}
        </Panel>
      )}
    </div>
  );
}
