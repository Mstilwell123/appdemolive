import { LaunchStepsNav } from "@/components/launch-steps-nav";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LoadError, Panel, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { CHANNELS, CHANNEL_LABELS, OWNERS, OWNER_LABELS, PLAN_DAYS, POSTING_CHECKLIST, STATUS_LABELS, type Channel, type ItemStatus, type Owner } from "@/domain/promotion-plan";
import { isDatabaseConfigured } from "@/lib/env";
import { AVAILABLE_STEPS } from "@/lib/launch-steps";
import { load } from "@/lib/page-load";
import { getPlan } from "@/services/promotion-plan";
import { confirmPostAction, generatePlanAction, recordPostAction, skipItemAction } from "./actions";

export const dynamic = "force-dynamic";
const DONE: Record<string, string> = { planned: "Plan built. Nothing is posted until you post it yourself.", recorded: "Post recorded. Our team will confirm it.", confirmed: "Post confirmed.", skipped: "Item skipped." };

export default async function PromotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error, done } = await searchParams;
  const data = await load(`/dashboard/launches/${id}/promote`, () => getPlan(id));
  if (!data) return <LoadError what="this promotion plan" />;
  const hidden = <input type="hidden" name="launchId" value={id} />;
  const recorded = data.items.some((i) => i.status === "posted_self_reported" || i.status === "confirmed");
  return (
    <div className="space-y-6">
      <LaunchStepsNav launchId={id} current="promote" available={AVAILABLE_STEPS} />
      <div>
        <h1 className="text-3xl font-bold">Step 4: Promote</h1>
        <p className="mt-1 text-slate-600">A {PLAN_DAYS}-day plan for posting your approved clips by hand. AppDemo never posts for you: download the clip, post it, then paste the live link here.</p>
      </div>
      <ErrorBanner message={error} />
      {done && DONE[done] && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{DONE[done]}</p>}

      {!recorded && (
        <Panel title={data.items.length ? "Rebuild the plan" : "Build your plan"}>
          {!data.approvedClips ? <p className="text-sm text-amber-800">Approve at least one clip in Create first.</p> : (
            <form action={generatePlanAction} className="space-y-3">
              {hidden}
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="text-sm font-medium">Channels</legend>
                {CHANNELS.map((c: Channel) => (
                  <div key={c} className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" name="channel" value={c} />{CHANNEL_LABELS[c]}</label>
                    <select name={`owner_${c}`} aria-label={`Who owns ${CHANNEL_LABELS[c]}`} className="rounded border border-slate-300 px-2 py-1 text-xs">
                      {OWNERS.map((o: Owner) => <option key={o} value={o}>{OWNER_LABELS[o]}</option>)}
                    </select>
                  </div>
                ))}
              </fieldset>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-slate-600">Start date<input type="date" name="startDate" required className={inputClass} /></label>
                <label className="text-xs text-slate-600">Time zone<input name="timezone" defaultValue="America/Los_Angeles" required className={inputClass} /></label>
              </div>
              <button className={buttonClass}>{data.items.length ? "Rebuild plan" : "Build plan"}</button>
            </form>
          )}
        </Panel>
      )}

      {data.items.map((i) => (
        <Panel key={i.id} title={`Day ${i.day} · ${i.planned_date} ${i.planned_time.slice(0, 5)} (${i.timezone}) · ${CHANNEL_LABELS[i.channel as Channel]}`}>
          <p className="text-xs font-semibold uppercase text-slate-500">{STATUS_LABELS[i.status as ItemStatus]} · {OWNER_LABELS[i.channel_owner as Owner]}</p>
          <p className="mt-2 text-sm"><strong>For:</strong> {i.audience} · <strong>Goal:</strong> {i.objective}</p>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-sm">{i.post_copy}</pre>
          {i.destination_url && <p className="mt-2 break-all text-sm">Link: {i.destination_url}</p>}
          {i.posted_url && <p className="mt-2 break-all text-sm">Posted: <a className="text-indigo-700 underline" href={i.posted_url} rel="noopener noreferrer">{i.posted_url}</a></p>}
          {i.status === "planned" && (i.blocker ? <p className="mt-2 text-sm text-amber-800">{i.blocker}</p> : (
            <div className="mt-3 flex flex-wrap gap-3">
              <form action={recordPostAction} className="space-y-2">
                {hidden}<input type="hidden" name="itemId" value={i.id} />
                {POSTING_CHECKLIST.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="check" value={c.id} required />{c.text}</label>)}
                <input name="postedUrl" type="url" required placeholder="https://… link to the live post" className={inputClass} />
                <button className={buttonClass}>I posted it</button>
              </form>
              <form action={skipItemAction}>{hidden}<input type="hidden" name="itemId" value={i.id} /><button className={secondaryButtonClass}>Skip</button></form>
            </div>
          ))}
          {i.status === "posted_self_reported" && data.isOperator && (
            <form action={confirmPostAction} className="mt-3">{hidden}<input type="hidden" name="itemId" value={i.id} /><button className={buttonClass}>Confirm after checking the live post</button></form>
          )}
        </Panel>
      ))}
    </div>
  );
}
