"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError } from "@/domain/errors";
import type { CaptureSource } from "@/domain/recording";
import { failTo, field } from "@/lib/action-errors";
import { uuidSchema } from "@/schemas/launch";
import { attachTranscript, beginUpload, completeUpload, saveCapturePlan, transcribeRecording } from "@/services/recordings";

const path = (id: string) => `/dashboard/launches/${id}/demonstrate`;
type Result<T> = { ok: true; data: T } | { ok: false; message: string };
const safe = (e: unknown) => (e instanceof AppError && e.code !== "INTERNAL_ERROR" ? e.message : "Something went wrong. Please try again.");

export async function saveCapturePlanAction(form: FormData) {
  const id = field(form, "launchId");
  try {
    await saveCapturePlan(uuidSchema.parse(id), { choice: field(form, "choice") || null, checked: form.getAll("checked").map(String), confidential: field(form, "confidential") });
  } catch (e) { failTo(path(id), e); }
  revalidatePath(path(id));
  redirect(`${path(id)}?saved=1`);
}

export async function beginUploadAction(launchId: string, file: { name: string; type: string; size: number }, source: CaptureSource, retryId?: string):
  Promise<Result<{ recordingId: string; path: string; token: string }>> {
  try {
    const r = await beginUpload(uuidSchema.parse(launchId), file, source === "browser_capture" ? "browser_capture" : "upload", retryId ? uuidSchema.parse(retryId) : undefined);
    return { ok: true, data: { recordingId: r.recordingId, path: r.path, token: r.token } };
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e);
    return { ok: false, message: safe(e) };
  }
}

export async function completeUploadAction(launchId: string, recordingId: string, objectPath: string): Promise<Result<null>> {
  try {
    await completeUpload(uuidSchema.parse(launchId), uuidSchema.parse(recordingId), objectPath);
    revalidatePath(path(launchId));
    return { ok: true, data: null };
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e);
    return { ok: false, message: safe(e) };
  }
}

export async function transcribeAction(form: FormData) {
  const id = field(form, "launchId");
  let msg: string | null = null;
  try {
    const r = await transcribeRecording(uuidSchema.parse(id), uuidSchema.parse(field(form, "recordingId")));
    if (!r.ok) msg = r.message;
  } catch (e) { failTo(path(id), e); }
  revalidatePath(path(id));
  redirect(msg ? `${path(id)}?error=${encodeURIComponent(msg)}` : `${path(id)}?saved=1`);
}

export async function attachTranscriptAction(form: FormData) {
  const id = field(form, "launchId");
  try { await attachTranscript(uuidSchema.parse(id), uuidSchema.parse(field(form, "recordingId")), field(form, "vtt").slice(0, 2_000_000)); } catch (e) { failTo(path(id), e); }
  revalidatePath(path(id));
  redirect(`${path(id)}?saved=1`);
}
