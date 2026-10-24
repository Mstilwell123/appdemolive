"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ASPECTS, DECISIONS, PLACEMENTS, type ClipContent, type Decision } from "@/domain/content-pack";
import { AppError } from "@/domain/errors";
import { failTo, field } from "@/lib/action-errors";
import { uuidSchema } from "@/schemas/launch";
import { addClip, beginExportUpload, completeExportUpload, dropClip, editClip, failExport, proposeContentPack, reviewClip } from "@/services/content-pack";

const path = (id: string) => `/dashboard/launches/${id}/create`;
type Result<T> = { ok: true; data: T } | { ok: false; message: string };
const safe = (e: unknown) => (e instanceof AppError && e.code !== "INTERNAL_ERROR" ? e.message : "Something went wrong. Please try again.");

/** "m:ss" or seconds → ms. Invalid input becomes -1 so validation rejects it. */
function toMs(v: string) {
  const m = v.trim().match(/^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/);
  return m ? Math.round(((Number(m[1] ?? 0) * 60) + Number(m[2])) * 1000) : -1;
}
const pick = <T extends string>(list: readonly T[], v: string, d: T) => ((list as readonly string[]).includes(v) ? v as T : d);

function readClip(form: FormData): ClipContent {
  return {
    viewer: field(form, "viewer"), purpose: field(form, "purpose"), why: field(form, "why"), hook: field(form, "hook"),
    startMs: toMs(field(form, "start")), endMs: toMs(field(form, "end")), onScreen: field(form, "onScreen"), caption: field(form, "caption"),
    claims: field(form, "claims").split("\n").map((s) => s.trim()).filter(Boolean), cta: field(form, "cta"),
    placement: pick(PLACEMENTS, field(form, "placement"), "short_video"), aspect: pick(ASPECTS, field(form, "aspect"), "9:16"),
  };
}

async function run(form: FormData, fn: (id: string) => Promise<unknown>, done: string) {
  const id = field(form, "launchId");
  try { await fn(uuidSchema.parse(id)); } catch (e) { failTo(path(id), e); }
  revalidatePath(path(id));
  redirect(`${path(id)}?done=${done}`);
}

export const proposeAction = async (form: FormData) => run(form, (id) => proposeContentPack(id), "proposed");
export const addClipAction = async (form: FormData) => run(form, (id) => addClip(id, readClip(form)), "added");
export const editClipAction = async (form: FormData) => run(form, (id) => editClip(id, uuidSchema.parse(field(form, "clipId")), readClip(form)), "edited");
export const dropClipAction = async (form: FormData) => run(form, (id) => dropClip(id, uuidSchema.parse(field(form, "clipId"))), "dropped");
export const failExportAction = async (form: FormData) => run(form, (id) => failExport(id, uuidSchema.parse(field(form, "versionId")), field(form, "reason")), "export_failed");
export const reviewAction = async (form: FormData) =>
  run(form, (id) => reviewClip(id, uuidSchema.parse(field(form, "versionId")), pick<Decision>(DECISIONS, field(form, "decision"), "revision_requested"), field(form, "reason")), "reviewed");

export async function beginExportAction(launchId: string, versionId: string, file: { name: string; type: string; size: number }): Promise<Result<{ path: string; token: string }>> {
  try { return { ok: true, data: await beginExportUpload(uuidSchema.parse(launchId), uuidSchema.parse(versionId), file) }; }
  catch (e) { if (!(e instanceof AppError)) console.error(e); return { ok: false, message: safe(e) }; }
}

export async function completeExportAction(launchId: string, versionId: string, p: string): Promise<Result<null>> {
  try { await completeExportUpload(uuidSchema.parse(launchId), uuidSchema.parse(versionId), p); revalidatePath(path(launchId)); return { ok: true, data: null }; }
  catch (e) { if (!(e instanceof AppError)) console.error(e); return { ok: false, message: safe(e) }; }
}
