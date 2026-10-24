import { SetupNotice } from "@/components/setup-notice";
import { Empty, ErrorBanner, LoadError, buttonClass, inputClass } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/env";
import { load } from "@/lib/page-load";
import { listApps } from "@/services/apps";
import { createLaunchAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewLaunchPage({ searchParams }: { searchParams: Promise<{ error?: string; app?: string }> }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const { error, app } = await searchParams;
  const apps = await load("/dashboard/launches/new", listApps);
  if (!apps) return <LoadError what="your apps" />;
  if (apps.length === 0) return <Empty title="Add your app first" body="Every launch is for one of your apps." href="/dashboard/apps/new" cta="Add your app" />;
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-3xl font-bold">Start a launch</h1>
      <ErrorBanner message={error} />
      <form action={createLaunchAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <label className="block text-sm">
          <span className="font-medium text-slate-800">Which app?</span>
          <select name="appId" required defaultValue={app ?? apps[0].id} className={inputClass}>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <p className="text-sm text-slate-600">The launch uses the app&apos;s latest version. If the app already has an open launch, we&apos;ll take you to it.</p>
        <button className={buttonClass}>Start launch</button>
      </form>
    </div>
  );
}
