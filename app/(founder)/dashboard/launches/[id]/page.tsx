import Link from "next/link";
import { CheckoutButton } from "@/components/checkout-button";
import { LaunchPlan } from "@/components/launch-plan";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LaunchStatusBadge, LoadError, Panel, TextArea, TextField, buttonClass, inputClass, money, secondaryButtonClass, when } from "@/components/ui";
import { stageInfo } from "@/domain/launch-stages";
import { isDatabaseConfigured } from "@/lib/env";
import { load } from "@/lib/page-load";
import { GOAL_LABELS, GOAL_TYPES } from "@/schemas/launch";
import { getLaunchDetail } from "@/services/launch-setup";
import { getLaunchNextAction } from "@/services/launches";
import { getLaunchPlan } from "@/services/preparation";
import type { LaunchStatus } from "@/types/launch";
import {
  addGoalAction, cancelLaunchAction, chooseLaunchTypeAction, removeGoalAction, setPrimaryGoalAction, updateLaunchDetailsAction,
} from "../../actions";

export const dynamic = "force-dynamic";

const TYPE_COPY = {
  founder_demo: { label: "Founder Demo", body: "You present your product live. AppDemo prepares the plan, runs the show and turns it into content." },
  cohosted_launch: { label: "Co-Hosted Launch Show", body: "An AppDemo host interviews you and guides the demo, plus a stronger launch package." },
} as const;
const GOALS_LOCKED: LaunchStatus[] = ["READY", "LIVE", "COMPLETED", "CANCELLED"];
const FOUNDER_CANCELLABLE: LaunchStatus[] = ["DRAFT", "INTAKE_IN_PROGRESS", "SUBMITTED", "QUALIFICATION_REVIEW", "QUALIFIED", "LAUNCH_TYPE_SELECTED", "CHANGES_REQUIRED"];
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function LaunchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error, saved } = await searchParams;
  const data = await load(`/dashboard/launches/${id}`, async () => ({ d: await getLaunchDetail(id), next: await getLaunchNextAction(id), plan: await getLaunchPlan(id) }));
  if (!data) return <LoadError what="this launch" />;
  const { d, next, plan } = data;
  const l = d.launch;
  const status = l.status as LaunchStatus;
  const app = one(l.apps as { id: string; name: string } | { id: string; name: string }[] | null);
  const version = one(l.app_versions as { version_label: string } | { version_label: string }[] | null);
  const canPickFormat = status === "QUALIFIED" || status === "LAUNCH_TYPE_SELECTED";
  const goalsLocked = GOALS_LOCKED.includes(status);
  const detailsLocked = ["LIVE", "COMPLETED", "CANCELLED"].includes(status);
  const paid = d.payments.some((p) => p.status === "succeeded");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/launches" className="text-sm text-slate-500 hover:text-slate-800">Launches</Link>
        <h1 className="flex items-center gap-3 text-3xl font-bold">{app?.name} launch <LaunchStatusBadge status={status} /></h1>
        <p className="text-slate-600">For {version?.version_label}. {stageInfo(status).appDemoDoing}</p>
      </div>
      <ErrorBanner message={error} />
      {saved && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Saved.</div>}

      <Panel title="Your action" highlight={next.blocking}>
        <p className="text-lg font-semibold">{next.title}</p>
        <p className="mt-1 text-slate-600">{next.description}</p>
        {next.blocking && next.href && !next.href.startsWith(`/dashboard/launches/${id}#`) && (
          <Link href={next.href} className={`mt-3 inline-block ${buttonClass}`}>Continue</Link>
        )}
      </Panel>

      <Panel title="Format and price" id="format">
        {canPickFormat ? (
          <div className="grid gap-4 md:grid-cols-2">
            {d.prices.map((p) => {
              const copy = TYPE_COPY[p.launch_type as keyof typeof TYPE_COPY];
              const selected = l.launch_type === p.launch_type;
              return (
                <form key={p.launch_type} action={chooseLaunchTypeAction} className={`rounded-lg border p-4 ${selected ? "border-indigo-500 ring-1 ring-indigo-200" : "border-slate-200"}`}>
                  <input type="hidden" name="launchId" value={id} />
                  <input type="hidden" name="launchType" value={p.launch_type} />
                  <p className="font-semibold">{copy.label}</p>
                  <p className="text-2xl font-bold">{money(p.amount, p.currency)}</p>
                  <p className="mt-1 text-sm text-slate-600">{copy.body}</p>
                  <button disabled={selected} className={`mt-3 ${selected ? secondaryButtonClass : buttonClass}`}>{selected ? "Selected" : "Choose"}</button>
                </form>
              );
            })}
          </div>
        ) : l.launch_type ? (
          <p>{TYPE_COPY[l.launch_type as keyof typeof TYPE_COPY].label} · {money(l.price_amount, l.currency)} <span className="text-sm text-slate-500">(price locked when chosen)</span></p>
        ) : (
          <p className="text-slate-600">You can choose a format after our team qualifies your app.</p>
        )}
      </Panel>

      <Panel title="Goals" id="goals">
        <p className="text-sm text-slate-600">What counts as success? Exactly one goal must be primary before your launch can go live.</p>
        {d.goals.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No goals yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {d.goals.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="font-medium">{GOAL_LABELS[g.goal_type as keyof typeof GOAL_LABELS]}</span>
                  {g.target_value != null && <span className="text-slate-500"> · target {g.target_value}</span>}
                  {g.destination_url && <span className="text-slate-500"> · {g.destination_url}</span>}
                  {g.is_primary && <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">Primary</span>}
                </span>
                {!goalsLocked && (
                  <span className="flex gap-2">
                    {!g.is_primary && (
                      <form action={setPrimaryGoalAction}><input type="hidden" name="launchId" value={id} /><input type="hidden" name="goalId" value={g.id} /><button className="text-indigo-700 hover:underline">Make primary</button></form>
                    )}
                    <form action={removeGoalAction}><input type="hidden" name="launchId" value={id} /><input type="hidden" name="goalId" value={g.id} /><button className="text-slate-500 hover:text-red-700">Remove</button></form>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {!goalsLocked && (
          <form action={addGoalAction} className="mt-4 grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="launchId" value={id} />
            <select name="goalType" required defaultValue="" className={inputClass}>
              <option value="" disabled>Goal type</option>
              {GOAL_TYPES.map((t) => <option key={t} value={t}>{GOAL_LABELS[t]}</option>)}
            </select>
            <input name="targetValue" type="number" min={0} step="any" placeholder="Target (optional)" className={inputClass} />
            <input name="destinationUrl" type="url" placeholder="Destination https:// (optional)" className={inputClass} />
            <button className={`mt-1 ${secondaryButtonClass}`}>Add goal</button>
          </form>
        )}
      </Panel>

      <Panel title="Payment" id="payment">
        {paid ? (
          <div className="space-y-1">
            <p className="font-semibold text-emerald-800">Payment received. Thank you.</p>
            {(() => {
              const p = d.payments.find((x) => x.status === "succeeded");
              return p ? <p className="text-sm text-slate-600">{money(p.amount, p.currency)} paid {when(p.created_at)}. Preparation has started.</p> : null;
            })()}
          </div>
        ) : status === "LAUNCH_TYPE_SELECTED" && l.launch_type ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200">
              <p className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Order summary</p>
              <dl className="divide-y divide-slate-100 text-sm">
                <div className="flex justify-between px-4 py-2"><dt className="text-slate-600">App</dt><dd>{app?.name} ({version?.version_label})</dd></div>
                <div className="flex justify-between px-4 py-2"><dt className="text-slate-600">Format</dt><dd>{TYPE_COPY[l.launch_type as keyof typeof TYPE_COPY].label}</dd></div>
                <div className="flex justify-between px-4 py-2"><dt className="text-slate-600">Billing</dt><dd>One-time payment</dd></div>
                <div className="flex justify-between px-4 py-2 text-base font-semibold"><dt>Total</dt><dd>{money(l.price_amount, l.currency)}</dd></div>
              </dl>
            </div>
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm text-slate-600">Your launch is held until payment is confirmed. You&apos;ll pay on Stripe&apos;s secure checkout page.</p>
              <CheckoutButton launchId={id} label={`Pay ${money(l.price_amount, l.currency)}`} />
            </div>
          </div>
        ) : (
          <p className="text-slate-600">Payment opens after you choose a format.</p>
        )}
      </Panel>

      <Panel title="Launch details" id="details">
        <form action={updateLaunchDetailsAction} className="space-y-4">
          <input type="hidden" name="launchId" value={id} />
          <TextArea label="Objective" name="objective" defaultValue={l.objective} disabled={detailsLocked} maxLength={1000} help="What should this launch achieve?" />
          <TextArea label="Audience" name="audience" defaultValue={l.audience} disabled={detailsLocked} maxLength={1000} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Call to action" name="ctaText" defaultValue={l.cta_text} disabled={detailsLocked} maxLength={280} placeholder="Start your free trial" />
            <TextField label="DM keyword" name="dmKeyword" defaultValue={l.dm_keyword} disabled={detailsLocked} maxLength={20} help="2–20 letters or numbers viewers can message to get your link." />
          </div>
          <TextField label="Tracked destination" name="trackedDestinationUrl" type="url" defaultValue={l.tracked_destination_url} disabled={detailsLocked} placeholder="https://" help="Where the call to action sends people. Tracking links are added later." />
          {!detailsLocked && <button className={buttonClass}>Save details</button>}
        </form>
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Schedule">
          <p className="text-slate-600">{l.scheduled_at ? when(l.scheduled_at) : "Scheduling opens during preparation."}</p>
        </Panel>
        <Panel title="People">
          <ul className="space-y-1 text-sm">
            {d.participants.map((p) => (
              <li key={p.id} className="flex justify-between"><span className="capitalize">{p.role}</span><span className="text-slate-500">{p.external_name ?? (p.role === "founder" ? "You" : "")} · {p.status}</span></li>
            ))}
            {!d.participants.some((p) => p.role === "moderator") && <li className="text-slate-500">A moderator is assigned during preparation.</li>}
          </ul>
        </Panel>
      </div>

      <Panel title="Launch plan" id="plan" highlight={status === "AWAITING_FOUNDER_APPROVAL"}>
        <LaunchPlan launchId={id} status={status} plan={plan as unknown as Parameters<typeof LaunchPlan>[0]["plan"]} />
        {l.run_of_show_notes && <p className="mt-4 whitespace-pre-line text-sm text-slate-600">{l.run_of_show_notes}</p>}
      </Panel>

      <Panel title="History">
        <ol className="space-y-1 text-sm">
          {d.history.map((h) => (
            <li key={h.id} className="flex justify-between gap-4">
              <span>{stageInfo(h.to_status as LaunchStatus).label}{h.reason ? <span className="text-slate-500"> · {h.reason}</span> : null}</span>
              <span className="shrink-0 text-slate-500">{when(h.created_at)}</span>
            </li>
          ))}
        </ol>
      </Panel>

      {FOUNDER_CANCELLABLE.includes(status) && (
        <form action={cancelLaunchAction} className="text-right">
          <input type="hidden" name="launchId" value={id} />
          <button className="text-sm text-slate-500 hover:text-red-700">Cancel this launch</button>
        </form>
      )}
    </div>
  );
}
