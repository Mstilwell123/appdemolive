import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/domain/errors";
import {
  CAPTURE_SOURCES, REHEARSAL_ITEMS, canMoveRecording, captureAllowed, parseVtt, safeObjectName, validateUpload,
  type CaptureSource, type RecordingStatus,
} from "@/domain/recording";
import { transcribeWithOpenAI } from "@/integrations/transcription/openai";
import { authorizeLaunch } from "@/services/preparation";

/** ASSUMPTION: private bucket created per environment by an operator. */
export const RECORDINGS_BUCKET = "launch-recordings";
const COLS = "id, source, status, storage_path, original_filename, content_type, size_bytes, duration_ms, transcript, transcript_source, failure_code, failure_message, attempts, created_at, updated_at";

export async function getCapture(launchId: string) {
  const { service, actorKind } = await authorizeLaunch(launchId);
  const [{ data: plan }, { data: recordings }, { data: brief }] = await Promise.all([
    service.from("launch_capture_plans").select("capture_choice, rehearsal_checked, confidential_sections, updated_at").eq("launch_id", launchId).maybeSingle(),
    service.from("launch_recordings").select(COLS).eq("launch_id", launchId).order("created_at", { ascending: false }),
    service.from("launch_runbooks").select("version, title, opening_hook, problem_statement, demo_plan, use_cases, questions, cta_script, duration_minutes")
      .eq("launch_id", launchId).eq("status", "approved").maybeSingle(),
  ]);
  return { plan, recordings: recordings ?? [], brief, isOperator: actorKind === "operator" };
}

export async function saveCapturePlan(launchId: string, input: { choice: string | null; checked: string[]; confidential: string }) {
  const { service, launch, user } = await authorizeLaunch(launchId);
  const choice = input.choice && (CAPTURE_SOURCES as readonly string[]).includes(input.choice) ? input.choice : null;
  const valid = new Set<string>(REHEARSAL_ITEMS.map((i) => i.id));
  const { error } = await service.from("launch_capture_plans").upsert({
    launch_id: launchId, organization_id: launch.organization_id, capture_choice: choice,
    rehearsal_checked: input.checked.filter((c) => valid.has(c)), confidential_sections: input.confidential.trim().slice(0, 4000) || null,
    updated_by: user.id, updated_at: new Date().toISOString(),
  });
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
}

async function move(service: SupabaseClient, id: string, from: RecordingStatus, to: RecordingStatus, patch: Record<string, unknown> = {}) {
  if (!canMoveRecording(from, to)) throw new AppError("INVALID_STATE_TRANSITION", `A recording can't go from ${from} to ${to}`);
  const { data, error } = await service.from("launch_recordings").update({ status: to, ...patch }).eq("id", id).eq("status", from).select("id");
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
  if (!data?.length) throw new AppError("INVALID_STATE_TRANSITION", "This recording changed in another tab. Reload and try again.");
}

async function getRec(service: SupabaseClient, launchId: string, recordingId: string) {
  const { data } = await service.from("launch_recordings").select(COLS).eq("id", recordingId).eq("launch_id", launchId).maybeSingle();
  if (!data) throw new AppError("NOT_FOUND", "Recording not found");
  return data as { id: string; status: RecordingStatus; storage_path: string | null; original_filename: string | null; size_bytes: number | null; attempts: number };
}

/**
 * Starts an upload: validates the file, records it as uploading and returns a one-time signed
 * upload URL for the private bucket. Retrying a failed or interrupted upload reuses the record.
 */
export async function beginUpload(launchId: string, file: { name: string; type: string; size: number }, source: CaptureSource, retryId?: string) {
  const { service, launch, user } = await authorizeLaunch(launchId);
  const problem = validateUpload(file);
  if (problem) throw new AppError("VALIDATION_FAILED", problem);
  const { data: plan } = await service.from("launch_capture_plans").select("rehearsal_checked").eq("launch_id", launchId).maybeSingle();
  if (!captureAllowed(plan?.rehearsal_checked ?? [])) throw new AppError("APPROVAL_REQUIRED", "Confirm the clean demo account and screen permission first.");
  const path = `${launch.organization_id}/${launchId}/${crypto.randomUUID()}-${safeObjectName(file.name)}`;
  let id = retryId;
  if (id) {
    const rec = await getRec(service, launchId, id);
    const stale = rec.status === "uploading" || rec.status === "failed" || rec.status === "awaiting_upload";
    if (!stale) throw new AppError("INVALID_STATE_TRANSITION", "This recording is already uploaded.");
    const { error } = await service.from("launch_recordings").update({
      status: "uploading", storage_path: null, original_filename: file.name, content_type: file.type, size_bytes: file.size,
      failure_code: null, failure_message: null, attempts: rec.attempts + 1,
    }).eq("id", id);
    if (error) throw new AppError("INTERNAL_ERROR", error.message);
  } else {
    const { data, error } = await service.from("launch_recordings").insert({
      organization_id: launch.organization_id, launch_id: launchId, source, status: "uploading",
      original_filename: file.name, content_type: file.type, size_bytes: file.size, attempts: 1, created_by: user.id,
    }).select("id").single();
    if (error) throw new AppError("INTERNAL_ERROR", error.message);
    id = data.id as string;
  }
  const { data: signed, error: signErr } = await service.storage.from(RECORDINGS_BUCKET).createSignedUploadUrl(path);
  if (signErr || !signed) {
    await service.from("launch_recordings").update({ status: "failed", failure_code: "storage_unavailable", failure_message: "Storage isn't ready for uploads yet." }).eq("id", id);
    throw new AppError("PROVIDER_UNAVAILABLE", "Uploads aren't available right now. Our team has been alerted; please try again later.");
  }
  return { recordingId: id, path, token: signed.token, signedUrl: signed.signedUrl };
}

/** Called after the browser finishes the upload. Verifies the object really exists before saying "uploaded". */
export async function completeUpload(launchId: string, recordingId: string, path: string) {
  const { service, launch } = await authorizeLaunch(launchId);
  if (!path.startsWith(`${launch.organization_id}/${launchId}/`)) throw new AppError("FORBIDDEN", "That file doesn't belong to this launch");
  const rec = await getRec(service, launchId, recordingId);
  const dir = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data: found } = await service.storage.from(RECORDINGS_BUCKET).list(dir, { search: name, limit: 1 });
  if (!found?.some((o) => o.name === name)) {
    await move(service, recordingId, rec.status, "failed", { failure_code: "upload_missing", failure_message: "The upload didn't arrive." });
    throw new AppError("PROCESSING_FAILED", "We couldn't find the uploaded file. Please upload it again.");
  }
  await move(service, recordingId, rec.status, "uploaded", { storage_path: path });
}

/** Operator (or a retry): transcribe a stored recording. Failures are recorded and recoverable. */
export async function transcribeRecording(launchId: string, recordingId: string) {
  const { service, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "operator") throw new AppError("FORBIDDEN", "Our team starts transcription");
  const rec = await getRec(service, launchId, recordingId);
  if (!rec.storage_path) throw new AppError("INVALID_STATE_TRANSITION", "Upload the recording first");
  await move(service, recordingId, rec.status, "transcribing", { failure_code: null, failure_message: null });
  const { data: blob, error } = await service.storage.from(RECORDINGS_BUCKET).download(rec.storage_path);
  const result = error || !blob
    ? { ok: false as const, code: "upload_missing" as const, message: "The stored file couldn't be read." }
    : await transcribeWithOpenAI(blob, { apiKey: process.env.OPENAI_API_KEY, filename: rec.original_filename ?? "recording" });
  if (!result.ok) {
    await move(service, recordingId, "transcribing", "failed", { failure_code: result.code, failure_message: result.message });
    return { ok: false as const, message: result.message };
  }
  await move(service, recordingId, "transcribing", "ready", { transcript: result.segments, transcript_source: "openai", duration_ms: result.durationMs });
  return { ok: true as const };
}

/** Founder or operator recovery: attach a WebVTT transcript to a stored recording. */
export async function attachTranscript(launchId: string, recordingId: string, vtt: string) {
  const { service } = await authorizeLaunch(launchId);
  const rec = await getRec(service, launchId, recordingId);
  if (!rec.storage_path) throw new AppError("INVALID_STATE_TRANSITION", "Upload the recording first; a transcript alone isn't a recording.");
  const segments = parseVtt(vtt);
  if (!segments.length) throw new AppError("VALIDATION_FAILED", "We couldn't read any timed lines. Paste a WebVTT file (00:00:01.000 --> 00:00:04.000).");
  if (rec.status === "failed") await move(service, recordingId, "failed", "uploaded", { failure_code: null, failure_message: null });
  const from = rec.status === "failed" ? "uploaded" : rec.status;
  await move(service, recordingId, from, "ready", { transcript: segments, transcript_source: "manual", duration_ms: segments[segments.length - 1].endMs });
}
