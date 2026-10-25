import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LaunchStatusBadge, LoadError, Panel, QualBadge, buttonClass, secondaryButtonClass, when } from "@/components/ui";
import { isDatabaseConfigured } from "@/lib/env";
import { load } from "@/lib/page-load";
import { getAppDetail } from "@/services/apps";
import { createLaunchAction, createNextVersionAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AppPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; submitted?: string }> }) {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error, submitted } = await searchParams;
  const d = await load(`/dashboard/apps/${id}`, () => getAppDetail(id));
  if (!d) return <LoadError what="this app" />;
  const { app, latest, intake, latestQualification: q, launches, versions } = d;
  const openLaunch = launches.find((l) => !["COMPLETED", "CANCELLED"].includes(l.status));
  const decided = q && ["qualified", "changes_required", "rejected"].includes(q.status);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/apps" className="text-sm text-slate-500 hover:text-slate-800">Apps</Link>
        <h1 className="text-3xl font-bold">{app.name}</h1>
        <p className="text-slate-600">{[app.category, app.website_url].filter(Boolean).join(" · ")}</p>
      </div>
      <ErrorBanner message={error} />
      {submitted && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Thanks. Your app is in our review queue.</div>}

      <Panel title="Intake">
        {intake?.status === "submitted" ? (
          <p className="text-slate-700">Submitted {when(intake.submitted_at)} for {latest?.version_label}.</p>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-slate-700">{q?.status === "changes_required" ? "Our team asked for changes. Update your answers and resubmit." : "Tell us who your app is for and what you want customers to do."}</p>
            <Link href={`/dashboard/apps/${app.id}/intake`} className={buttonClass}>{intake ? "Continue intake" : "Start intake"}</Link>
          </div>
        )}
      </Panel>

      <Panel title="Review">
        {!q ? (
          <p className="text-slate-600">Your app is reviewed after you submit the intake.</p>
        ) : (
          <div className="space-y-2">
            <p className="flex items-center gap-2"><QualBadge status={q.status} /> <span className="text-sm text-slate-500">{latest?.version_label}</span></p>
            {q.review_notes && decided && <p className="whitespace-pre-line rounded-md bg-slate-50 p-3 text-sm text-slate-700">{q.review_notes}</p>}
            {decided && (
              <form action={createNextVersionAction}>
                <input type="hidden" name="appId" value={app.id} />
                <button className={secondaryButtonClass}>Start a new version</button>
                <span className="ml-3 text-xs text-slate-500">Use this when your product, pricing or policies change. It gets its own review.</span>
              </form>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Launch">
        {openLaunch ? (
          <Link href={`/dashboard/launches/${openLaunch.id}`} className="flex items-center justify-between hover:underline">
            <span>Your launch</span> <LaunchStatusBadge status={openLaunch.status} />
          </Link>
        ) : q?.status === "rejected" ? (
          <p className="text-slate-600">This version wasn&apos;t approved for launch. Start a new version to try again.</p>
        ) : (
          <form action={createLaunchAction} className="flex items-center justify-between gap-4">
            <input type="hidden" name="appId" value={app.id} />
            <input type="hidden" name="from" value="app" />
            <p className="text-slate-600">Start a launch for {latest?.version_label}. You choose the format once your app is qualified.</p>
            <button className={buttonClass}>Start a launch</button>
          </form>
        )}
      </Panel>

      <Panel title="Versions">
        <ul className="space-y-2 text-sm">
          {versions.map((v) => {
            const vq = d.qualifications.find((x) => x.app_version_id === v.id);
            return (
              <li key={v.id} className="flex items-center justify-between">
                <span>{v.version_label} <span className="text-slate-500">· created {when(v.created_at)}</span></span>
                {vq ? <QualBadge status={vq.status} /> : <span className="text-slate-500">Not submitted</span>}
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
