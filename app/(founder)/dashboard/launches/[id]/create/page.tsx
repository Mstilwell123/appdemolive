import { ExportUpload } from "@/components/export-upload";
import { LaunchStepsNav } from "@/components/launch-steps-nav";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LoadError, Panel, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { ASPECTS, PLACEMENTS, PLACEMENT_LABELS, REVISION_ROUNDS, fmtTime, type ClipContent } from "@/domain/content-pack";
import { isSupabaseConfigured } from "@/lib/env";
import { AVAILABLE_STEPS } from "@/lib/launch-steps";
import { load } from "@/lib/page-load";
import { getContentPack } from "@/services/content-pack";
import { addClipAction, dropClipAction, editClipAction, failExportAction, proposeAction, reviewAction } from "./actions";

export const dynamic = "force-dynamic";
const DONE: Record<string, string> = {
  proposed: "Clips proposed.", added: "Clip added.", edited: "Saved as a new version. It needs review again before it can be posted.",
  dropped: "Clip removed.", export_failed: "Export marked as failed.", reviewed: "Review recorded.",
};
const STATE_STYLE: Record<string, string> = {
  Approved: "bg-emerald-100 text-emerald-900", Rejected: "bg-red-100 text-red-900", "Revision requested": "bg-amber-100 text-amber-900",
  "Waiting for your approval": "bg-indigo-100 text-indigo-900", "In team review": "bg-slate-100 text-slate-700",
};
const EXPORT_LABEL = { not_started: "Export not made yet", rendering: "Export uploading", ready: "Export ready", failed: "Export failed" } as const;

function ClipFields({ c }: { c?: ClipContent }) {
  const t = (ms?: number) => (ms === undefined ? "" : fmtTime(ms));
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-xs text-slate-600">Who it&apos;s for<input name="viewer" defaultValue={c?.viewer} maxLength={300} className={inputClass} /></label>
      <label className="text-xs text-slate-600">Purpose<input name="purpose" defaultValue={c?.purpose} maxLength={300} className={inputClass} /></label>
      <label className="text-xs text-slate-600 sm:col-span-2">Why this moment is useful<input name="why" defaultValue={c?.why} maxLength={600} className={inputClass} /></label>
      <label className="text-xs text-slate-600 sm:col-span-2">Hook<input name="hook" defaultValue={c?.hook} maxLength={300} className={inputClass} /></label>
      <label className="text-xs text-slate-600">Starts at (m:ss)<input name="start" defaultValue={t(c?.startMs)} className={inputClass} /></label>
      <label className="text-xs text-slate-600">Ends at (m:ss)<input name="end" defaultValue={t(c?.endMs)} className={inputClass} /></label>
      <label className="text-xs text-slate-600 sm:col-span-2">On-screen text<input name="onScreen" defaultValue={c?.onScreen} maxLength={1000} className={inputClass} /></label>
      <label className="text-xs text-slate-600 sm:col-span-2">Caption / post copy<textarea name="caption" defaultValue={c?.caption} rows={4} maxLength={2200} className={inputClass} /></label>
      <label className="text-xs text-slate-600 sm:col-span-2">Factual claims made (one per line)<textarea name="claims" defaultValue={c?.claims.join("\n")} rows={2} className={inputClass} /></label>
      <label className="text-xs text-slate-600">Call to action<input name="cta" defaultValue={c?.cta} maxLength={300} className={inputClass} /></label>
      <label className="text-xs text-slate-600">Where it goes
        <select name="placement" defaultValue={c?.placement ?? "short_video"} className={inputClass}>{PLACEMENTS.map((p) => <option key={p} value={p}>{PLACEMENT_LABELS[p]}</option>)}</select>
      </label>
      <label className="text-xs text-slate-600">Shape
        <select name="aspect" defaultValue={c?.aspect ?? "9:16"} className={inputClass}>{ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
      </label>
    </div>
  );
}

export default async function CreatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error, done } = await searchParams;
  const data = await load(`/dashboard/launches/${id}/create`, () => getContentPack(id));
  if (!data) return <LoadError what="this content pack" />;
  const { clips, isOperator, truthApproved, recording } = data;
  const approved = clips.filter((c) => c.state.approved);
  const hidden = <input type="hidden" name="launchId" value={id} />;

  return (
    <div className="space-y-6">
      <LaunchStepsNav launchId={id} current="create" available={AVAILABLE_STEPS} />
      <div>
        <h1 className="text-3xl font-bold">Step 3: Create</h1>
        <p className="mt-1 text-slate-600">Your content pack: clips cut from your demo, each with a purpose. Watch each export, check the copy, then approve, ask for a change, or reject it. Editing anything creates a new version that needs approval again.</p>
      </div>
      <ErrorBanner message={error} />
      {done && DONE[done] && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{DONE[done]}</p>}

      <Panel title="Your pack" highlight={approved.length > 0}>
        <ul className="space-y-1 text-sm">
          <li>Recording: {recording?.url ? <a className="text-indigo-700 underline" href={recording.url}>Download {recording.name ?? "recording"}</a> : "not ready yet"}</li>
          <li>Transcript: {recording ? <a className="text-indigo-700 underline" href={`/dashboard/launches/${id}/create/transcript.vtt`}>Download captions (.vtt)</a> : "not ready yet"}</li>
          <li>Approved clips: {approved.length} of {clips.length}. Downloads, copy and hooks for each are below; the posting plan uses only approved versions.</li>
        </ul>
      </Panel>

      {!clips.length && (
        <Panel title="No clips yet">
          {!truthApproved && <p className="text-sm text-amber-800">Your truth sheet needs approving first, so every clip&apos;s claims can be checked.</p>}
          {!recording && <p className="text-sm text-amber-800">Clips are cut from the finished recording and transcript.</p>}
          {isOperator ? (
            <form action={proposeAction} className="mt-3">{hidden}<button className={buttonClass} disabled={!truthApproved || !recording}>Propose clips from the transcript</button></form>
          ) : <p className="mt-2 text-sm text-slate-600">Our team will propose about eight clips once your recording and truth sheet are ready.</p>}
        </Panel>
      )}

      {clips.map((c) => {
        const v = c.current, k = v.content;
        return (
          <Panel key={c.id} title={`Clip ${c.position}: ${k.purpose} · v${v.version}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 ${STATE_STYLE[c.state.label]}`}>{c.state.label}</span>
              <span className={`rounded-full px-2 py-0.5 ${v.export_status === "failed" ? "bg-red-100 text-red-900" : "bg-slate-100 text-slate-700"}`}>{EXPORT_LABEL[v.export_status]}</span>
              <span className="text-slate-500">{fmtTime(k.startMs)}–{fmtTime(k.endMs)} · {k.aspect} · {PLACEMENT_LABELS[k.placement]}</span>
              {c.versions > 1 && <span className="text-slate-500">{c.versions} versions</span>}
            </div>
            {v.export_status === "failed" && <p className="mt-2 text-sm text-red-800">Export failed: {v.export_error}. {isOperator ? "Upload it again below." : "Our team will redo it."}</p>}
            {c.exportUrl && <video controls preload="metadata" src={c.exportUrl} className="mt-3 max-h-96 rounded-lg bg-black" />}
            <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="text-slate-500">For</dt><dd>{k.viewer}</dd>
              <dt className="text-slate-500">Why this moment</dt><dd>{k.why || "—"}</dd>
              <dt className="text-slate-500">Hook</dt><dd>{k.hook}</dd>
              {k.onScreen && <><dt className="text-slate-500">On screen</dt><dd>{k.onScreen}</dd></>}
              <dt className="text-slate-500">Caption</dt><dd className="whitespace-pre-wrap">{k.caption}</dd>
              <dt className="text-slate-500">Claims</dt><dd>{k.claims.length ? k.claims.join("; ") : "None"}</dd>
              <dt className="text-slate-500">Call to action</dt><dd>{k.cta}</dd>
            </dl>
            {c.exportUrl && <p className="mt-2 text-sm"><a className="text-indigo-700 underline" href={c.exportUrl}>Download this video</a></p>}
            {c.reviews.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {c.reviews.filter((r) => r.reason).map((r) => <li key={r.id}>{r.stage === "internal" ? "Team" : "You"}: {r.decision.replace("_", " ")} — {r.reason}</li>)}
              </ul>
            )}

            <div className="mt-4 rounded-lg border border-slate-200 p-3">
              {isOperator ? (
                <div className="flex flex-wrap items-start gap-3">
                  <ExportUpload launchId={id} versionId={v.id} label={v.export_status === "ready" ? "Replace export" : "Upload export"} />
                  <form action={failExportAction} className="flex gap-2">{hidden}<input type="hidden" name="versionId" value={v.id} />
                    <input name="reason" placeholder="Why the export failed" className={`${inputClass} mt-0`} /><button className={secondaryButtonClass}>Mark failed</button></form>
                </div>
              ) : c.blockers.length > 0 && !c.state.approved && (
                <ul className="mb-2 list-disc pl-5 text-sm text-amber-900">{c.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              )}
              {!c.state.approved && (
                <form action={reviewAction} className="mt-3 space-y-2">{hidden}<input type="hidden" name="versionId" value={v.id} />
                  <label className="block text-xs text-slate-600">{isOperator ? "Team review note" : "What should change? (needed to request a revision or reject)"}
                    <input name="reason" maxLength={1000} className={inputClass} /></label>
                  <div className="flex flex-wrap gap-2">
                    <button name="decision" value="approved" className={buttonClass} disabled={!isOperator && c.blockers.length > 0}>{isOperator ? "Pass team review" : `Approve v${v.version}`}</button>
                    <button name="decision" value="revision_requested" className={secondaryButtonClass}>Request a revision</button>
                    <button name="decision" value="rejected" className={secondaryButtonClass}>Reject</button>
                  </div>
                  {!isOperator && <p className="text-xs text-slate-500">Revision rounds used: {c.revisionsUsed} of {REVISION_ROUNDS}.</p>}
                </form>
              )}
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Edit (creates v{v.version + 1})</summary>
              <form action={editClipAction} className="mt-3 space-y-3">{hidden}<input type="hidden" name="clipId" value={c.id} />
                <ClipFields c={k} /><button className={secondaryButtonClass}>Save as v{v.version + 1}</button></form>
              {isOperator && <form action={dropClipAction} className="mt-2">{hidden}<input type="hidden" name="clipId" value={c.id} /><button className="text-sm text-red-700 underline">Remove this clip</button></form>}
            </details>
          </Panel>
        );
      })}

      {isOperator && clips.length > 0 && (
        <Panel title="Add a clip by hand">
          <form action={addClipAction} className="space-y-3">{hidden}<ClipFields /><button className={secondaryButtonClass}>Add clip</button></form>
        </Panel>
      )}
    </div>
  );
}
