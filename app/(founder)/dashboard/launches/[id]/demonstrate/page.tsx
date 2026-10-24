import { LaunchStepsNav } from "@/components/launch-steps-nav";
import { RecordingCapture } from "@/components/recording-capture";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LoadError, Panel, buttonClass, inputClass, secondaryButtonClass, when } from "@/components/ui";
import { REHEARSAL_ITEMS, REQUIRED_REHEARSAL, captureAllowed, recordingComplete, recordingGuidance, uploadInterrupted, type RecordingLike } from "@/domain/recording";
import { isDatabaseConfigured } from "@/lib/env";
import { AVAILABLE_STEPS } from "@/lib/launch-steps";
import { load } from "@/lib/page-load";
import { getCapture } from "@/services/recordings";
import { attachTranscriptAction, saveCapturePlanAction, transcribeAction } from "./actions";

export const dynamic = "force-dynamic";
const CHOICES = [
  { v: "upload", label: "Upload a recording", body: "Record with any tool you trust, then upload the file. Works on phones." },
  { v: "browser_capture", label: "Record in this browser", body: "Desktop browsers that support screen recording. You'll be asked for permission first." },
  { v: "provider", label: "Record during the live show", body: "Our team records the show on the studio provider and adds the file for you." },
];
const mb = (n: number | null) => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : "");

export default async function DemonstratePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error, saved } = await searchParams;
  const data = await load(`/dashboard/launches/${id}/demonstrate`, () => getCapture(id));
  if (!data) return <LoadError what="this demonstration" />;
  const { plan, recordings, brief, isOperator } = data;
  const checked: string[] = plan?.rehearsal_checked ?? [];
  const allowed = captureAllowed(checked);
  const now = Date.now();
  const anyComplete = recordings.some((r) => recordingComplete(r as RecordingLike));

  return (
    <div className="space-y-6">
      <LaunchStepsNav launchId={id} current="demonstrate" available={AVAILABLE_STEPS} />
      <div>
        <h1 className="text-3xl font-bold">Step 2: Demonstrate</h1>
        <p className="mt-1 text-slate-600">Rehearse from your approved brief, choose how to capture, and record the real app. Processing happens in the background; you can leave this page.</p>
      </div>
      <ErrorBanner message={error} />
      {saved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Saved.</p>}

      <Panel title="Your demo brief">
        {brief ? (
          <div className="space-y-2 text-sm">
            <p className="text-slate-500">Approved run-of-show v{brief.version} · {brief.duration_minutes} minutes</p>
            {brief.opening_hook && <p><span className="font-semibold">Opening: </span>{brief.opening_hook}</p>}
            {brief.problem_statement && <p><span className="font-semibold">Problem: </span>{brief.problem_statement}</p>}
            {Array.isArray(brief.demo_plan) && brief.demo_plan.length > 0 && (
              <ol className="list-decimal pl-5">{(brief.demo_plan as Array<{ step?: string; title?: string } | string>).map((s, i) => <li key={i}>{typeof s === "string" ? s : s.step ?? s.title ?? ""}</li>)}</ol>
            )}
            {brief.cta_script && <p><span className="font-semibold">Close: </span>{brief.cta_script}</p>}
          </div>
        ) : (
          <p className="text-sm text-slate-600">Your brief appears here after you approve the launch plan. You can still rehearse and capture now.</p>
        )}
      </Panel>

      <Panel title="Rehearsal and capture choice" highlight={!allowed}>
        <form action={saveCapturePlanAction} className="space-y-4">
          <input type="hidden" name="launchId" value={id} />
          <fieldset>
            <legend className="text-sm font-semibold">Rehearsal checklist</legend>
            <ul className="mt-2 space-y-1">
              {REHEARSAL_ITEMS.map((it) => (
                <li key={it.id}><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="checked" value={it.id} defaultChecked={checked.includes(it.id)} className="mt-1" />
                  <span>{it.text}{REQUIRED_REHEARSAL.includes(it.id) && <span className="text-xs text-amber-800"> (required)</span>}</span></label></li>
              ))}
            </ul>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">How will you capture?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {CHOICES.map((c) => (
                <label key={c.v} className="rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-500">
                  <input type="radio" name="choice" value={c.v} defaultChecked={plan?.capture_choice === c.v} /> <span className="font-semibold">{c.label}</span>
                  <span className="mt-1 block text-slate-600">{c.body}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-semibold">Sections to keep out of public clips
            <textarea name="confidential" rows={3} maxLength={4000} defaultValue={plan?.confidential_sections ?? ""} className={inputClass} placeholder="e.g. the billing settings screen, anything after 12:30" />
          </label>
          <button className={secondaryButtonClass}>Save</button>
        </form>
      </Panel>

      <Panel title="Capture">
        <RecordingCapture launchId={id} allowed={allowed} />
      </Panel>

      <Panel title="Recordings" highlight={recordings.length > 0 && !anyComplete}>
        {recordings.length === 0 ? <p className="text-sm text-slate-600">No recording yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {recordings.map((r) => {
              const g = recordingGuidance(r as RecordingLike, now);
              const retryable = r.status === "failed" || uploadInterrupted(r as RecordingLike, now);
              return (
                <li key={r.id} className="space-y-2 py-3 text-sm">
                  <p className="flex flex-wrap justify-between gap-2"><span className="font-medium">{r.original_filename ?? "Recording"} <span className="text-slate-500">{mb(r.size_bytes)} · {r.source.replace("_", " ")}</span></span><span className="text-slate-500">{when(r.created_at)}</span></p>
                  <p><span className={`rounded-full px-2 py-0.5 text-xs ${recordingComplete(r as RecordingLike) ? "bg-emerald-100 text-emerald-900" : r.status === "failed" ? "bg-red-100 text-red-900" : "bg-slate-100 text-slate-700"}`}>{g.label}</span>
                    {r.failure_message && <span className="ml-2 text-slate-600">{r.failure_message}</span>}</p>
                  {g.recovery.length > 0 && <ul className="list-disc pl-5 text-slate-600">{g.recovery.map((s) => <li key={s.text}>{s.who === "operator" ? "Our team: " : "You: "}{s.text}</li>)}</ul>}
                  {retryable && !r.storage_path && <details><summary className="cursor-pointer text-indigo-700">Upload again</summary><div className="mt-2"><RecordingCapture launchId={id} allowed={allowed} retryId={r.id} /></div></details>}
                  {r.storage_path && r.status !== "ready" && r.status !== "transcribing" && (
                    <div className="flex flex-wrap gap-3">
                      {isOperator && <form action={transcribeAction}><input type="hidden" name="launchId" value={id} /><input type="hidden" name="recordingId" value={r.id} /><button className="text-indigo-700 hover:underline">Start transcription</button></form>}
                      <details className="w-full"><summary className="cursor-pointer text-indigo-700">Paste a transcript</summary>
                        <form action={attachTranscriptAction} className="mt-2 space-y-2"><input type="hidden" name="launchId" value={id} /><input type="hidden" name="recordingId" value={r.id} />
                          <textarea name="vtt" rows={6} required className={inputClass} placeholder={"WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nHi, I'm…"} />
                          <button className={buttonClass}>Attach transcript</button></form></details>
                    </div>
                  )}
                  {recordingComplete(r as RecordingLike) && <p className="text-slate-600">{(r.transcript as unknown[]).length} transcript lines · {r.transcript_source === "manual" ? "added by hand" : "transcribed"}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
