"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { validateUpload } from "@/domain/recording";
import { getBrowserClient } from "@/lib/supabase/browser";
import { beginUploadAction, completeUploadAction } from "@/app/(founder)/dashboard/launches/[id]/demonstrate/actions";
import { buttonClass, secondaryButtonClass } from "@/components/ui";

const BUCKET = "launch-recordings";
type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "error"; text: string } | { kind: "done" };

/** Upload is always available. Browser screen capture is offered only when the browser supports it, and starts only on an explicit click. */
export function RecordingCapture({ launchId, allowed, retryId }: { launchId: string; allowed: boolean; retryId?: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [canCapture, setCanCapture] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    setCanCapture(typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia) && typeof window.MediaRecorder !== "undefined");
  }, []);

  async function send(file: File, source: "upload" | "browser_capture") {
    const problem = validateUpload(file);
    if (problem) return setPhase({ kind: "error", text: problem });
    setPhase({ kind: "busy", text: "Preparing upload…" });
    const begun = await beginUploadAction(launchId, { name: file.name, type: file.type, size: file.size }, source, retryId);
    if (!begun.ok) return setPhase({ kind: "error", text: begun.message });
    setPhase({ kind: "busy", text: "Uploading… keep this tab open." });
    const client = getBrowserClient();
    if (!client) return setPhase({ kind: "error", text: "Uploads aren't available right now." });
    const { error } = await client.storage.from(BUCKET).uploadToSignedUrl(begun.data.path, begun.data.token, file, { contentType: file.type });
    if (error) return setPhase({ kind: "error", text: "The upload was interrupted. Your brief is unchanged; try again." });
    const done = await completeUploadAction(launchId, begun.data.recordingId, begun.data.path);
    if (!done.ok) return setPhase({ kind: "error", text: done.message });
    setPhase({ kind: "done" });
    router.refresh();
  }

  async function startCapture() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "" });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        void send(new File(chunks, `screen-capture-${Date.now()}.webm`, { type: "video/webm" }), "browser_capture");
      };
      stream.getVideoTracks()[0]?.addEventListener("ended", () => rec.state !== "inactive" && rec.stop());
      recorder.current = rec;
      rec.start(1000);
      setRecording(true);
    } catch {
      setPhase({ kind: "error", text: "Screen recording wasn't allowed or isn't available. Upload a recording file instead." });
    }
  }

  if (!allowed) return <p className="text-sm text-amber-900">Confirm the clean demo account and screen permission in the rehearsal checklist before capturing.</p>;
  const busy = phase.kind === "busy";
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium" htmlFor="rec-file">Upload a recording</label>
        <p className="text-xs text-slate-500">MP4, MOV, WebM, MP3, M4A or WAV, up to 2 GB. On a phone, use its screen recorder, then upload here.</p>
        <input id="rec-file" type="file" accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/webm" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f, "upload"); }} className="mt-2 block w-full text-sm" />
      </div>
      <div>
        <p className="text-sm font-medium">Record your screen in this browser</p>
        {canCapture ? (
          recording ? (
            <button type="button" className={buttonClass} onClick={() => recorder.current?.stop()}>Stop and upload</button>
          ) : (
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void startCapture()}>Allow screen recording</button>
          )
        ) : (
          <p className="text-xs text-slate-500">This browser can&apos;t record the screen. Upload a file instead, or use a desktop Chrome, Edge or Firefox.</p>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {phase.kind === "busy" && phase.text}
        {phase.kind === "done" && <span className="text-emerald-800">Uploaded. We&apos;ll transcribe it next.</span>}
        {phase.kind === "error" && <span className="text-red-700">{phase.text}</span>}
      </p>
    </div>
  );
}
