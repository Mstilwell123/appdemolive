import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { Empty, LoadError, QualBadge, when } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/env";
import { load } from "@/lib/page-load";
import { listQualificationQueue } from "@/services/qualification";

export const dynamic = "force-dynamic";

export default async function QualificationQueuePage({ searchParams }: { searchParams: Promise<{ decided?: string }> }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const { decided } = await searchParams;
  const queue = await load("/operator/qualifications", listQualificationQueue);
  if (!queue) return <LoadError what="the queue" />;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Qualification queue</h1>
      {decided && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Decision recorded.</div>}
      {queue.length === 0 ? (
        <Empty title="Nothing to review" body="New submissions appear here, oldest first." />
      ) : (
        <table className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr><th className="px-4 py-2">App</th><th className="px-4 py-2">Version</th><th className="px-4 py-2">Organization</th><th className="px-4 py-2">Submitted</th><th className="px-4 py-2">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {queue.map((q) => (
              <tr key={q.id} className="hover:bg-slate-50">
                <td className="px-4 py-3"><Link href={`/operator/qualifications/${q.id}`} className="font-medium text-indigo-700 hover:underline">{q.appName}</Link></td>
                <td className="px-4 py-3">{q.versionLabel}</td>
                <td className="px-4 py-3">{q.orgName}</td>
                <td className="px-4 py-3">{when(q.created_at)}</td>
                <td className="px-4 py-3"><QualBadge status={q.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
