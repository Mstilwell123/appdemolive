"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/browser";
import { beginExportAction, completeExportAction } from "@/app/(founder)/dashboard/launches/[id]/create/actions";

const BUCKET = "launch-recordings";

/** Operator-only: upload the rendered export for one clip version. Failure leaves the clip visibly failed and retryable. */
export function ExportUpload({ launchId, versionId, label }: { launchId: string; versionId: string; label: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onFile(file: File) {
    setBusy(true); setMsg(null);
    const begun = await beginExportAction(launchId, versionId, { name: file.name, type: file.type, size: file.size });
    if (!begun.ok) { setMsg(begun.message); setBusy(false); return; }
    const client = getBrowserClient();
    if (!client) { setMsg("Uploads aren't available in this environment."); setBusy(false); return; }
    const { error } = await client.storage.from(BUCKET).uploadToSignedUrl(begun.data.path, begun.data.token, file, { contentType: file.type });
    const done = error ? { ok: false as const, message: "The upload was interrupted. Try again." } : await completeExportAction(launchId, versionId, begun.data.path);
    if (!done.ok) setMsg(done.message);
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="text-sm">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50">
        {busy ? "Uploading…" : label}
        <input type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
      </label>
      {msg && <p role="alert" className="mt-1 text-red-700">{msg}</p>}
    </div>
  );
}
