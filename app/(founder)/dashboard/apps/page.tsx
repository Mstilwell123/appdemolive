import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { Empty, LoadError } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/env";
import { load } from "@/lib/page-load";
import { listApps } from "@/services/apps";

export const dynamic = "force-dynamic";

export default async function AppsPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const apps = await load("/dashboard/apps", listApps);
  if (!apps) return <LoadError what="your apps" />;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Your apps</h1>
        <Link href="/dashboard/apps/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Add an app</Link>
      </div>
      {apps.length === 0 ? (
        <Empty title="No apps yet" body="Add your app to start the review and plan your launch." href="/dashboard/apps/new" cta="Add your app" />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {apps.map((a) => {
            const versions = (a.app_versions ?? []) as Array<{ version_label: string; version_number: number }>;
            const latest = versions.sort((x, y) => y.version_number - x.version_number)[0];
            return (
              <li key={a.id}>
                <Link href={`/dashboard/apps/${a.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50">
                  <div>
                    <p className="font-semibold">{a.name}</p>
                    <p className="text-sm text-slate-500">{[a.category, a.website_url].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className="text-sm text-slate-500">{latest?.version_label ?? ""}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
