import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LaunchStatusBadge, LoadError, Panel, QualBadge, buttonClass, inputClass, when } from "@/components/ui";
import { decisionProblem } from "@/domain/qualification";
import { isSupabaseConfigured } from "@/lib/env";
import { load } from "@/lib/page-load";
import { AREA_LABELS, QUALIFICATION_AREAS, type AreaStatus, type QualificationArea } from "@/schemas/qualification";
import { getQualificationReview } from "@/services/qualification";
import { decideAction, reviewAreaAction } from "../../actions";

export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function QualificationReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error } = await searchParams;
  const r = await load(`/operator/qualifications/${id}`, () => getQualificationReview(id));
  if (!r) return <LoadError what="this review" />;
  const { q, version, intake, events, orgName, launches, reviewers } = r;
  const app = one(version?.apps as { name: string; website_url: string | null; description: string | null; category: string | null } | null);
  const open = ["pending", "in_review"].includes(q.status);
  const areas = Object.fromEntries(QUALIFICATION_AREAS.map((a) => [a, q[`${a}_status`]])) as Record<QualificationArea, AreaStatus>;
  const canQualify = decisionProblem(areas, "qualified", null) === null;
  const who = (uid: string) => { const p = reviewers.find((x) => x.id === uid); return p?.full_name ?? p?.email ?? "Operator"; };
  const Row = ({ label, value }: { label: string; value?: string | null }) => (
    <div><dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt><dd className="whitespace-pre-line text-sm">{value || <span className="text-slate-400">Not provided</span>}</dd></div>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/operator/qualifications" className="text-sm text-slate-400 hover:text-slate-800">Queue</Link>
        <h1 className="flex items-center gap-3 text-3xl font-bold">{app?.name} {version?.version_label} <QualBadge status={q.status} /></h1>
        <p className="text-slate-600">{orgName} · opened {when(q.created_at)}</p>
      </div>
      <ErrorBanner message={error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Founder's answers (this version)">
          <dl className="space-y-3">
            <Row label="Founder" value={intake?.founder_name} />
            <Row label="Company" value={intake?.company_name} />
            <Row label="Category" value={app?.category} />
            <Row label="Description" value={intake?.founder_description} />
            <Row label="Intended customer" value={intake?.target_customer} />
            <Row label="Problem" value={intake?.problem_solved} />
            <Row label="Desired outcome" value={intake?.desired_outcome} />
            <Row label="Desired action" value={intake?.desired_action} />
          </dl>
        </Panel>
        <Panel title="Links (this version)">
          <dl className="space-y-3">
            {(["product_url", "pricing_url", "privacy_url", "terms_url"] as const).map((k) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wide text-slate-500">{k.replace("_url", "")}</dt>
                <dd className="text-sm">{version?.[k] ? <a href={version[k]} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-indigo-700 hover:underline">{version[k]}</a> : <span className="text-slate-400">Not provided</span>}</dd>
              </div>
            ))}
          </dl>
          {launches.length > 0 && (
            <div className="mt-4 space-y-1 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Launches on this version</p>
              {launches.map((l) => <p key={l.id}><LaunchStatusBadge status={l.status} /></p>)}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Review areas">
        <div className="space-y-4">
          {QUALIFICATION_AREAS.map((a) => (
            <form key={a} id={a} action={reviewAreaAction} className="grid scroll-mt-6 gap-3 border-b border-slate-100 pb-4 md:grid-cols-[14rem_10rem_1fr_auto] md:items-start">
              <input type="hidden" name="qualificationId" value={q.id} />
              <input type="hidden" name="area" value={a} />
              <div className="pt-2 text-sm font-medium">{AREA_LABELS[a]} <span className="ml-1"><QualBadge status={areas[a]} /></span></div>
              <select name="status" defaultValue={areas[a]} disabled={!open} className={inputClass}>
                <option value="pending">Pending</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="n_a">Not applicable</option>
              </select>
              <textarea name="notes" rows={2} defaultValue={q[`${a}_notes`] ?? ""} disabled={!open} maxLength={4000} placeholder="Notes (internal)" className={inputClass} />
              {open && <button className={`mt-1 ${buttonClass}`}>Save</button>}
            </form>
          ))}
        </div>
      </Panel>

      {open && (
        <Panel title="Final decision" id="decision">
          <form action={decideAction} className="space-y-3">
            <input type="hidden" name="qualificationId" value={q.id} />
            <textarea name="notes" rows={3} maxLength={4000} className={inputClass} placeholder="Notes for the founder. Required when asking for changes or rejecting." />
            <div className="flex flex-wrap gap-3">
              <button name="decision" value="qualified" disabled={!canQualify} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">Qualify {version?.version_label}</button>
              <button name="decision" value="changes_required" className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">Request changes</button>
              <button name="decision" value="rejected" className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Reject</button>
            </div>
            {!canQualify && <p className="text-xs text-slate-500">Every area must pass or be not applicable before you can qualify.</p>}
            <p className="text-xs text-slate-500">Your decision applies to {version?.version_label} only. Notes are shown to the founder.</p>
          </form>
        </Panel>
      )}

      <Panel title="Audit trail">
        {events.length === 0 ? <p className="text-sm text-slate-500">No review activity yet.</p> : (
          <ol className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex justify-between gap-4">
                <span><span className="font-medium">{e.area === "decision" ? "Decision" : AREA_LABELS[e.area as QualificationArea]}</span>: <QualBadge status={e.status} /> {e.notes && <span className="text-slate-600"> · {e.notes}</span>}</span>
                <span className="shrink-0 text-slate-500">{who(e.reviewer_id)} · {when(e.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
