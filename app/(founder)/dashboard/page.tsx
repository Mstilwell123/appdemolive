import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { AppError } from "@/domain/errors";
import { FOUNDER_STAGES, hasResultsStage, stageInfo } from "@/domain/launch-stages";
import { isSupabaseConfigured } from "@/lib/env";
import { getDashboardData, type DashboardData } from "@/services/dashboard";

export const dynamic = "force-dynamic";

const LAUNCH_TYPE_LABEL = { founder_demo: "Founder Demo", cohosted_launch: "Co-Hosted Launch Show" } as const;

function Panel({ title, children, highlight = false }: { title: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <section className={`rounded-xl border bg-white p-6 ${highlight ? "border-indigo-300 ring-1 ring-indigo-100" : "border-slate-200"}`}>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  let data: DashboardData;
  try {
    data = await getDashboardData();
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAUTHORIZED") redirect("/login?next=/dashboard");
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
        <h2 className="font-semibold">We couldn&apos;t load your dashboard</h2>
        <p className="mt-1 text-sm">Please refresh. If it keeps happening, contact support@pragvance.ai.</p>
      </div>
    );
  }

  const { app, launch, nextAction } = data;
  const info = launch ? stageInfo(launch.status) : null;
  const currentStageIndex = info?.stage ? FOUNDER_STAGES.indexOf(info.stage) : -1;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">{data.organizationName}</p>
        <h1 className="text-3xl font-bold">Welcome{data.fullName ? `, ${data.fullName}` : ""}</h1>
      </div>

      <Panel title="Your action" highlight={nextAction.blocking}>
        {nextAction.blocking ? (
          <>
            <p className="text-xl font-semibold">{nextAction.title}</p>
            <p className="mt-1 text-slate-600">{nextAction.description}</p>
            {nextAction.href && (
              <Link href={nextAction.href} className="mt-4 inline-block rounded-md bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700">
                Continue
              </Link>
            )}
          </>
        ) : (
          <p className="text-slate-600">Nothing is needed from you right now.</p>
        )}
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Your app">
          {app ? (
            <>
              <p className="font-semibold">{app.name}</p>
              {app.websiteUrl && <p className="mt-1 truncate text-sm text-slate-600">{app.websiteUrl}</p>}
            </>
          ) : (
            <p className="text-slate-600">You haven&apos;t added an app yet.</p>
          )}
        </Panel>

        <Panel title="Your launch">
          {launch ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Format</dt><dd>{launch.launchType ? LAUNCH_TYPE_LABEL[launch.launchType] : "Not chosen yet"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Launch time</dt><dd>{launch.scheduledAt ? formatWhen(launch.scheduledAt) : "Not scheduled yet"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Goal</dt><dd>{launch.primaryGoalType ? launch.primaryGoalType.replaceAll("_", " ") : "Not set yet"}</dd></div>
            </dl>
          ) : (
            <p className="text-slate-600">You don&apos;t have a launch yet.</p>
          )}
        </Panel>
      </div>

      <Panel title="Current step">
        {launch && info ? (
          <>
            <p className="font-semibold">{info.label}</p>
            <ol className="mt-4 flex flex-wrap gap-2 text-xs">
              {FOUNDER_STAGES.map((s, i) => (
                <li
                  key={s}
                  className={`rounded-full px-3 py-1 ${
                    i === currentStageIndex ? "bg-indigo-600 text-white" : i < currentStageIndex ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {s}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-slate-600">Your launch steps appear here once you start a launch.</p>
        )}
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="What AppDemo is doing">
          <p className="text-slate-600">
            {info?.appDemoDoing ?? (launch ? "Waiting on your next step." : "Ready when you are. Add your app to get started.")}
          </p>
        </Panel>

        <Panel title="What's next">
          <p className="text-slate-600">{info?.whatsNext ?? "Add your app, then we review it and help you plan your launch."}</p>
        </Panel>
      </div>

      <Panel title="Results">
        {launch && hasResultsStage(launch.status) ? (
          <p className="text-slate-600">Your results report is coming soon.</p>
        ) : (
          <p className="text-slate-600">Clicks, signups and sales from your launch will appear here after you go live.</p>
        )}
      </Panel>
    </div>
  );
}
