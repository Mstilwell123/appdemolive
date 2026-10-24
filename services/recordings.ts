import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { launch_capture_plans, launch_recordings, launch_runbooks } from "@/db/schema";
import { AppError } from "@/domain/errors";
import {
  CAPTURE_SOURCES, MAX_UPLOAD_BYTES, REHEARSAL_ITEMS, canMoveRecording, captureAllowed, parseVtt, safeObjectName, validateUpload,
  type CaptureSource, type RecordingStatus,
} from "@/domain/recording";
import { getStorage } from "@/integrations/storage";
import { transcribeWithOpenAI } from "@/integrations/transcription/openai";
import type { Db } from "@/lib/db";
import { authorizeLaunch } from "@/services/session";

const COLS = {
  id: launch_recordings.id, source: launch_recordings.source, status: launch_recordings.status, storage_path: launch_recordings.storage_path,
  original_filename: launch_recordings.original_filename, content_type: launch_recordings.content_type, size_bytes: launch_recordings.size_bytes,
  duration_ms: launch_recordings.duration_ms, transcript: launch_recordings.transcript, transcript_source: launch_recordings.transcript_source,
  failure_code: launch_recordings.failure_code, failure_message: launch_recordings.failure_message, attempts: launch_recordings.attempts,
  created_at: launch_recordings.created_at, updated_at: launch_recordings.updated_at,
};
const unavailable = () => new AppError("PROVIDER_UNAVAILABLE", "Uploads aren't available right now. Our team has been alerted; please try again later.");

export async function getCapture(launchId: string) {
  const { db, actorKind } = await authorizeLaunch(launchId);
  const [[plan], recordings, [brief]] = await Promise.all([
    db.select({ capture_choice: launch_capture_plans.capture_choice, rehearsal_checked: launch_capture_plans.rehearsal_checked,
      confidential_sections: launch_capture_plans.confidential_sections, updated_at: launch_capture_plans.updated_at })
      .from(launch_capture_plans).where(eq(launch_capture_plans.launch_id, launchId)),
    db.select(COLS).from(launch_recordings).where(eq(launch_recordings.launch_id, launchId)).orderBy(desc(launch_recordings.created_at)),
    db.select({ version: launch_runbooks.version, title: launch_runbooks.title, opening_hook: launch_runbooks.opening_hook,
      problem_statement: launch_runbooks.problem_statement, demo_plan: launch_runbooks.demo_plan, use_cases: launch_runbooks.use_cases,
      questions: launch_runbooks.questions, cta_script: launch_runbooks.cta_script, duration_minutes: launch_runbooks.duration_minutes })
      .from(launch_runbooks).where(and(eq(launch_runbooks.launch_id, launchId), eq(launch_runbooks.status, "approved"))),
  ]);
  return { plan: plan ?? null, recordings, brief: brief ?? null, isOperator: actorKind === "operator" };
}

export async function saveCapturePlan(launchId: string, input: { choice: string | null; checked: string[]; confidential: string }) {
  const { db, launch, user } = await authorizeLaunch(launchId);
  const choice = input.choice && (CAPTURE_SOURCES as readonly string[]).includes(input.choice) ? input.choice : null;
  const valid = new Set<string>(REHEARSAL_ITEMS.map((i) => i.id));
  const row = {
    capture_choice: choice, rehearsal_checked: [...new Set(input.checked.filter((c) => valid.has(c)))],
    confidential_sections: input.confidential.trim().slice(0, 4000) || null, updated_by: user.id, updated_at: new Date().toISOString(),
  };
  await db.insert(launch_capture_plans).values({ launch_id: launchId, organization_id: launch.organization_id, ...row })
    .onConflictDoUpdate({ target: launch_capture_plans.launch_id, set: row });
}

/** Compare-and-set status change: a stale tab can never overwrite a newer state. */
async function move(db: Db, id: string, from: RecordingStatus, to: RecordingStatus, patch: Partial<typeof launch_recordings.$inferInsert> = {}) {
  if (!canMoveRecording(from, to)) throw new AppError("INVALID_STATE_TRANSITION", `A recording can't go from ${from} to ${to}`);
  const rows = await db.update(launch_recordings).set({ status: to, ...patch })
    .where(and(eq(launch_recordings.id, id), eq(launch_recordings.status, from))).returning({ id: launch_recordings.id });
  if (!rows.length) throw new AppError("INVALID_STATE_TRANSITION", "This recording changed in another tab. Reload and try again.");
}

async function getRec(db: Db, launchId: string, recordingId: string) {
  const [row] = await db.select({ ...COLS, pending_path: launch_recordings.pending_path }).from(launch_recordings)
    .where(and(eq(launch_recordings.id, recordingId), eq(launch_recordings.launch_id, launchId)));
  if (!row) throw new AppError("NOT_FOUND", "Recording not found");
  return { ...row, status: row.status as RecordingStatus };
}

/**
 * Starts an upload: validates the file, records it as uploading and returns a short-lived signed
 * upload target. The object key is chosen by the server and pinned on the record, so completion
 * can only ever point at the file this launch was given. Retrying reuses the record.
 */
export async function beginUpload(launchId: string, file: { name: string; type: string; size: number }, source: CaptureSource, retryId?: string) {
  const { db, launch, user } = await authorizeLaunch(launchId);
  const problem = validateUpload(file);
  if (problem) throw new AppError("VALIDATION_FAILED", problem);
  const [plan] = await db.select({ checked: launch_capture_plans.rehearsal_checked }).from(launch_capture_plans).where(eq(launch_capture_plans.launch_id, launchId));
  if (!captureAllowed(plan?.checked ?? [])) throw new AppError("APPROVAL_REQUIRED", "Confirm the clean demo account and screen permission first.");
  const storage = getStorage();
  if (!storage) throw unavailable();
  const path = `${launch.organization_id}/${launchId}/${crypto.randomUUID()}-${safeObjectName(file.name)}`;
  let id = retryId;
  if (id) {
    const rec = await getRec(db, launchId, id);
    if (!["uploading", "failed", "awaiting_upload"].includes(rec.status)) throw new AppError("INVALID_STATE_TRANSITION", "This recording is already uploaded.");
    const rows = await db.update(launch_recordings).set({
      status: "uploading", storage_path: null, pending_path: path, original_filename: file.name, content_type: file.type, size_bytes: file.size,
      failure_code: null, failure_message: null, attempts: rec.attempts + 1,
    }).where(and(eq(launch_recordings.id, id), eq(launch_recordings.status, rec.status))).returning({ id: launch_recordings.id });
    if (!rows.length) throw new AppError("INVALID_STATE_TRANSITION", "This recording changed in another tab. Reload and try again.");
  } else {
    const [row] = await db.insert(launch_recordings).values({
      organization_id: launch.organization_id, launch_id: launchId, source, status: "uploading", pending_path: path,
      original_filename: file.name, content_type: file.type, size_bytes: file.size, attempts: 1, created_by: user.id,
    }).returning({ id: launch_recordings.id });
    id = row.id;
  }
  try {
    const target = await storage.createUploadTarget(path, file.type, Math.min(file.size, MAX_UPLOAD_BYTES));
    return { recordingId: id, upload: target };
  } catch {
    await db.update(launch_recordings).set({ status: "failed", failure_code: "storage_unavailable", failure_message: "Storage isn't ready for uploads yet." }).where(eq(launch_recordings.id, id));
    throw unavailable();
  }
}

/** Called after the browser finishes the upload. Verifies the object really exists before saying "uploaded". */
export async function completeUpload(launchId: string, recordingId: string) {
  const { db } = await authorizeLaunch(launchId);
  const rec = await getRec(db, launchId, recordingId);
  if (rec.status !== "uploading" || !rec.pending_path) throw new AppError("INVALID_STATE_TRANSITION", "Start the upload again.");
  const storage = getStorage();
  const found = storage ? await storage.exists(rec.pending_path) : null;
  if (!found) {
    await move(db, recordingId, "uploading", "failed", { failure_code: "upload_missing", failure_message: "The upload didn't arrive." });
    throw new AppError("PROCESSING_FAILED", "We couldn't find the uploaded file. Please upload it again.");
  }
  await move(db, recordingId, "uploading", "uploaded", { storage_path: rec.pending_path, pending_path: null, size_bytes: found.size });
}

/** Operator (or a retry): transcribe a stored recording. Failures are recorded and recoverable. */
export async function transcribeRecording(launchId: string, recordingId: string) {
  const { db, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "operator") throw new AppError("FORBIDDEN", "Our team starts transcription");
  const rec = await getRec(db, launchId, recordingId);
  if (!rec.storage_path) throw new AppError("INVALID_STATE_TRANSITION", "Upload the recording first");
  await move(db, recordingId, rec.status, "transcribing", { failure_code: null, failure_message: null });
  const blob = await getStorage()?.read(rec.storage_path);
  const result = !blob
    ? { ok: false as const, code: "upload_missing" as const, message: "The stored file couldn't be read." }
    : await transcribeWithOpenAI(blob, { apiKey: process.env.OPENAI_API_KEY, filename: rec.original_filename ?? "recording" });
  if (!result.ok) {
    await move(db, recordingId, "transcribing", "failed", { failure_code: result.code, failure_message: result.message });
    return { ok: false as const, message: result.message };
  }
  await move(db, recordingId, "transcribing", "ready", { transcript: result.segments, transcript_source: "openai", duration_ms: result.durationMs });
  return { ok: true as const };
}

/** Founder or operator recovery: attach a WebVTT transcript to a stored recording. */
export async function attachTranscript(launchId: string, recordingId: string, vtt: string) {
  const { db } = await authorizeLaunch(launchId);
  const rec = await getRec(db, launchId, recordingId);
  if (!rec.storage_path) throw new AppError("INVALID_STATE_TRANSITION", "Upload the recording first; a transcript alone isn't a recording.");
  const segments = parseVtt(vtt);
  if (!segments.length) throw new AppError("VALIDATION_FAILED", "We couldn't read any timed lines. Paste a WebVTT file (00:00:01.000 --> 00:00:04.000).");
  if (rec.status === "failed") await move(db, recordingId, "failed", "uploaded", { failure_code: null, failure_message: null });
  const from = rec.status === "failed" ? "uploaded" : rec.status;
  await move(db, recordingId, from, "ready", { transcript: segments, transcript_source: "manual", duration_ms: segments[segments.length - 1].endMs });
}

/** Signed, short-lived link to the original file for members of the launch's org (and operators). */
export async function recordingDownloadUrl(launchId: string, recordingId: string) {
  const { db } = await authorizeLaunch(launchId);
  const rec = await getRec(db, launchId, recordingId);
  const storage = getStorage();
  if (!rec.storage_path) throw new AppError("INVALID_STATE_TRANSITION", "This recording hasn't finished uploading.");
  if (!storage) throw unavailable();
  return storage.downloadUrl(rec.storage_path);
}
