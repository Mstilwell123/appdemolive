import { headers } from "next/headers";
import { LaunchStepsNav } from "@/components/launch-steps-nav";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LoadError, Panel, buttonClass } from "@/components/ui";
import { metricText } from "@/domain/tracked-links";
import { isDatabaseConfigured } from "@/lib/env";
import { AVAILABLE_STEPS } from "@/lib/launch-steps";
import { load } from "@/lib/page-load";
import { getMeasure } from "@/services/tracked-links";
import { createLinksAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MeasurePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error, done } = await searchParams;
  const data = await load(`/dashboard/launches/${id}/measure`, () => getMeasure(id));
  if (!data) return <LoadError what="this launch's results" />;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  return (
    <div className="space-y-6">
      <LaunchStepsNav launchId={id} current="measure" available={AVAILABLE_STEPS} />
      <div>
        <h1 className="text-3xl font-bold">Step 5: Measure</h1>
        <p className="mt-1 text-slate-600">Clicks on your tracked links. Repeat clicks from the same visitor within 30 minutes count once. Sources we aren&apos;t connected to show as unavailable, not zero.</p>
      </div>
      <ErrorBanner message={error} />
      {done === "links" && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Tracked links created. Use them in your posts.</p>}
      <Panel title="Results">
        <dl className="grid gap-3 sm:grid-cols-3">
          {data.metrics.map((m) => (
            <div key={m.source} className="rounded-lg border border-slate-200 p-3">
              <dt className="text-xs text-slate-500">{m.label}</dt>
              <dd className={m.status === "connected" ? "text-2xl font-bold" : "text-sm text-slate-500"}>{metricText(m)}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel title="Tracked links">
        {!data.planItems ? <p className="text-sm text-slate-600">Build your promotion plan first; each post gets its own link.</p> : (
          <form action={createLinksAction} className="mb-3"><input type="hidden" name="launchId" value={id} /><button className={buttonClass}>Create links for plan items</button></form>
        )}
        <ul className="space-y-2 text-sm">
          {data.links.map((l) => (
            <li key={l.id} className="break-all rounded border border-slate-200 p-2">
              <code>{origin}/r/{l.slug}</code> → {l.destination}{l.channel ? ` · ${l.channel}` : ""} · <strong>{l.clicks}</strong> click{l.clicks === 1 ? "" : "s"}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
