import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { Empty, LaunchStatusBadge, LoadError, money } from "@/components/ui";
import { isDatabaseConfigured } from "@/lib/env";
import { load } from "@/lib/page-load";
import { listLaunches } from "@/services/launch-setup";

export const dynamic = "force-dynamic";
const TYPE = { founder_demo: "Founder Demo", cohosted_launch: "Co-Hosted Launch Show" } as Record<string, string>;
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function LaunchesPage() {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const launches = await load("/dashboard/launches", listLaunches);
  if (!launches) return <LoadError what="your launches" />;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Your launches</h1>
        <Link href="/dashboard/launches/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Start a launch</Link>
      </div>
      {launches.length === 0 ? (
        <Empty title="No launches yet" body="Start a launch for one of your apps. We review the app first, then you pick a format." href="/dashboard/launches/new" cta="Start a launch" />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {launches.map((l) => {
            const app = one(l.apps as { name: string } | { name: string }[] | null);
            const v = one(l.app_versions as { version_label: string } | { version_label: string }[] | null);
            return (
              <li key={l.id}>
                <Link href={`/dashboard/launches/${l.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50">
                  <div>
                    <p className="font-semibold">{app?.name} <span className="text-sm font-normal text-slate-500">{v?.version_label}</span></p>
                    <p className="text-sm text-slate-500">{l.launch_type ? `${TYPE[l.launch_type]} · ${money(l.price_amount, l.currency)}` : "Format not chosen yet"}</p>
                  </div>
                  <LaunchStatusBadge status={l.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
