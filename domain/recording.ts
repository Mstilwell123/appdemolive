/**
 * PRD v1.4 §118.2: guided demonstration and capture. Processing is asynchronous; an interrupted
 * upload, missing file or transcription failure never marks the recording complete and never
 * touches the approved brief (truth sheet / runbook).
 */
export const RECORDING_STATUSES = ["awaiting_upload", "uploading", "uploaded", "transcribing", "ready", "failed"] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];
export const CAPTURE_SOURCES = ["upload", "browser_capture", "provider"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

const NEXT: Record<RecordingStatus, RecordingStatus[]> = {
  awaiting_upload: ["uploading", "failed"],
  uploading: ["uploaded", "failed", "uploading"],
  uploaded: ["transcribing", "ready", "failed"],
  transcribing: ["ready", "failed"],
  ready: [],
  failed: ["uploading", "uploaded", "transcribing"], // recoverable: retry the step that failed
};
export const canMoveRecording = (from: RecordingStatus, to: RecordingStatus) => NEXT[from].includes(to);

export interface RecordingLike {
  status: RecordingStatus;
  storage_path: string | null;
  transcript: unknown[] | null;
  updated_at: string;
  failure_code?: string | null;
}

/** Complete means the original file is stored AND a transcript exists. Nothing else counts. */
export const recordingComplete = (r: RecordingLike) =>
  r.status === "ready" && Boolean(r.storage_path) && Array.isArray(r.transcript) && r.transcript.length > 0;

/** ASSUMPTION: an upload with no progress for 30 minutes is treated as interrupted. */
export const UPLOAD_STALL_MS = 30 * 60 * 1000;
export const uploadInterrupted = (r: RecordingLike, now = Date.now()) =>
  r.status === "uploading" && now - new Date(r.updated_at).getTime() > UPLOAD_STALL_MS;

export interface RecoveryStep { who: "founder" | "operator"; text: string }
/** What the founder sees for each state, including a recovery path on failure. */
export function recordingGuidance(r: RecordingLike, now = Date.now()): { label: string; recovery: RecoveryStep[] } {
  if (uploadInterrupted(r, now)) return { label: "Upload interrupted", recovery: [{ who: "founder", text: "Upload the file again. Your brief and earlier approvals are unchanged." }] };
  switch (r.status) {
    case "awaiting_upload": return { label: "Waiting for your recording", recovery: [] };
    case "uploading": return { label: "Uploading", recovery: [] };
    case "uploaded": return { label: "Uploaded, waiting for transcription", recovery: [{ who: "operator", text: "Our team starts transcription or adds the transcript." }] };
    case "transcribing": return { label: "Transcribing", recovery: [] };
    case "ready": return { label: recordingComplete(r) ? "Recording ready" : "Missing transcript", recovery: [] };
    case "failed": {
      const code = r.failure_code ?? "unknown";
      if (code === "upload_missing") return { label: "We couldn't find the uploaded file", recovery: [{ who: "founder", text: "Upload the file again." }] };
      if (code === "too_large_for_transcription" || code === "transcription_unavailable" || code === "transcription_failed") {
        return { label: "Transcription didn't finish", recovery: [{ who: "operator", text: "Our team retries or adds the transcript by hand. Your recording is kept." }, { who: "founder", text: "You can paste a transcript (WebVTT) yourself." }] };
      }
      return { label: "Something went wrong", recovery: [{ who: "operator", text: "Our team has been alerted and will retry." }] };
    }
  }
}

export const ALLOWED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm"] as const;
/** ASSUMPTION: 2 GB per source recording for the first release. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export function validateUpload(f: { name: string; type: string; size: number }): string | null {
  if (!ALLOWED_TYPES.includes(f.type as (typeof ALLOWED_TYPES)[number])) return "Upload an MP4, MOV, WebM, MP3, M4A or WAV file.";
  if (f.size <= 0) return "That file is empty.";
  if (f.size > MAX_UPLOAD_BYTES) return "That file is over 2 GB. Trim it or contact support.";
  if (f.name.length > 200) return "Rename the file to something shorter.";
  return null;
}
export const safeObjectName = (name: string) => name.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(-120) || "recording";

export const REHEARSAL_ITEMS = [
  { id: "clean_account", text: "I'm using a clean demo account with no real customer data." },
  { id: "screen_permission", text: "I have permission to show everything on screen." },
  { id: "walkthrough", text: "I've rehearsed the walkthrough in order." },
  { id: "use_case", text: "I can show one realistic use case end to end." },
  { id: "objections", text: "I know my answers to the likely buying objections." },
  { id: "cta", text: "I'll close with the approved call to action." },
] as const;
export type RehearsalId = (typeof REHEARSAL_ITEMS)[number]["id"];
/** The two consent items are required before any capture; the rest are guidance. */
export const REQUIRED_REHEARSAL: RehearsalId[] = ["clean_account", "screen_permission"];
export const captureAllowed = (checked: readonly string[]) => REQUIRED_REHEARSAL.every((id) => checked.includes(id));

export interface TranscriptSegment { startMs: number; endMs: number; text: string }
const ts = (s: string) => {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})$/);
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
};
/** Parses WebVTT (or SRT-style) cues into transcript segments. Returns [] if nothing usable. */
export function parseVtt(input: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const block of input.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n").filter(Boolean);
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = ts(a), end = ts((b ?? "").trim().split(/\s+/)[0] ?? "");
    const text = lines.slice(i + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (start == null || end == null || end <= start || !text) continue;
    out.push({ startMs: start, endMs: end, text: text.slice(0, 2000) });
  }
  return out.slice(0, 5000);
}
