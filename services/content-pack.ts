import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ASPECTS, PLACEMENTS, REVISION_ROUNDS, founderApprovalBlockers, proposeClips, revisionsUsed, versionState,
  type ClipContent, type Decision, type ExportStatus, type ReviewLike, type Stage,
} from "@/domain/content-pack";
import { AppError } from "@/domain/errors";
import { recordingComplete, safeObjectName, type RecordingLike, type TranscriptSegment } from "@/domain/recording";
import type { TruthItem } from "@/domain/truth-sheet";
import { authorizeLaunch } from "@/services/preparation";
import { RECORDINGS_BUCKET } from "@/services/recordings";

export const clipContentSchema = z.object({
  viewer: z.string().trim().min(1, "Say who the clip is for").max(300),
  purpose: z.string().trim().min(1, "Say what the clip is for").max(300),
  why: z.string().trim().max(600).default(""),
  hook: z.string().trim().min(1, "Add a hook").max(300),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  onScreen: z.string().trim().max(1000).default(""),
  caption: z.string().trim().min(1, "Add a caption").max(2200),
  claims: z.array(z.string().trim().min(1).max(300)).max(10),
  cta: z.string().trim().min(1, "Add a call to action").max(300),
  placement: z.enum(PLACEMENTS),
  aspect: z.enum(ASPECTS),
}).refine((c) => c.endMs > c.startMs, "The clip must end after it starts");

export interface VersionRow { id: string; clip_id: string; version: number; content: ClipContent; export_status: ExportStatus; export_path: string | null; export_error: string | null; created_at: string }
export interface ReviewRow extends ReviewLike { id: string; reason: string | null; created_at: string }
const VCOLS = "id, clip_id, version, content, export_status, export_path, export_error, created_at";

async function approvedTruth(service: SupabaseClient, launchId: string) {
  const { data } = await service.from("launch_truth_sheets").select("items").eq("launch_id", launchId).eq("status", "approved").maybeSingle();
  return (data?.items as TruthItem[] | undefined) ?? null;
}

async function readyRecording(service: SupabaseClient, launchId: string) {
  const { data } = await service.from("launch_recordings").select("id, status, storage_path, transcript, updated_at, original_filename")
    .eq("launch_id", launchId).eq("status", "ready").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data && recordingComplete(data as RecordingLike) ? data as { id: string; storage_path: string; transcript: TranscriptSegment[]; original_filename: string | null } : null;
}

async function latestVersion(service: SupabaseClient, launchId: string, clipId: string) {
  const { data } = await service.from("launch_clip_versions").select(VCOLS).eq("launch_id", launchId).eq("clip_id", clipId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!data) throw new AppError("NOT_FOUND", "Clip not found");
  return data as VersionRow;
}

async function versionById(service: SupabaseClient, launchId: string, versionId: string) {
  const { data } = await service.from("launch_clip_versions").select(VCOLS).eq("launch_id", launchId).eq("id", versionId).maybeSingle();
  if (!data) throw new AppError("NOT_FOUND", "Clip version not found");
  const v = data as VersionRow;
  const latest = await latestVersion(service, launchId, v.clip_id);
  if (latest.id !== v.id) throw new AppError("INVALID_STATE_TRANSITION", "This clip was edited since you opened it. Review the newest version.");
  return v;
}

/** Everything the founder needs in one place: recording, transcript, clips with state, and download links. */
export async function getContentPack(launchId: string) {
  const { service, actorKind } = await authorizeLaunch(launchId);
  const [{ data: clips }, { data: versions }, { data: reviews }, truth, recording] = await Promise.all([
    service.from("launch_clips").select("id, position, status, recording_id").eq("launch_id", launchId).order("position"),
    service.from("launch_clip_versions").select(VCOLS).eq("launch_id", launchId).order("version"),
    service.from("launch_clip_reviews").select("id, version_id, stage, decision, reason, created_at").eq("launch_id", launchId).order("created_at"),
    approvedTruth(service, launchId),
    readyRecording(service, launchId),
  ]);
  const allReviews = (reviews ?? []) as ReviewRow[];
  const allVersions = (versions ?? []) as VersionRow[];
  const sign = async (p: string | null) => {
    if (!p) return null;
    const { data } = await service.storage.from(RECORDINGS_BUCKET).createSignedUrl(p, 3600, { download: true });
    return data?.signedUrl ?? null;
  };
  const items = await Promise.all((clips ?? []).filter((c) => c.status === "active").map(async (c) => {
    const vs = allVersions.filter((v) => v.clip_id === c.id);
    const current = vs.at(-1)!;
    const vIds = new Set(vs.map((v) => v.id));
    const clipReviews = allReviews.filter((r) => vIds.has(r.version_id));
    const state = versionState(current, clipReviews);
    return {
      id: c.id as string, position: c.position as number, current, versions: vs.length, reviews: clipReviews, state,
      revisionsUsed: revisionsUsed(clipReviews),
      blockers: founderApprovalBlockers(current, state.internal, current.content, truth),
      exportUrl: current.export_status === "ready" ? await sign(current.export_path) : null,
    };
  }));
  return {
    clips: items, isOperator: actorKind === "operator", truthApproved: !!truth,
    recording: recording ? { id: recording.id, name: recording.original_filename, url: await sign(recording.storage_path), segments: recording.transcript.length } : null,
  };
}

/** Operator: propose candidates from the ready recording. Needs an approved truth sheet. Runs once. */
export async function proposeContentPack(launchId: string) {
  const { service, launch, user, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "operator") throw new AppError("FORBIDDEN", "Our team proposes the clips");
  if (!(await approvedTruth(service, launchId))) throw new AppError("APPROVAL_REQUIRED", "The founder needs to approve the truth sheet first");
  const rec = await readyRecording(service, launchId);
  if (!rec) throw new AppError("INVALID_STATE_TRANSITION", "There's no recording with a transcript yet");
  const { count } = await service.from("launch_clips").select("id", { count: "exact", head: true }).eq("launch_id", launchId);
  if (count) throw new AppError("INVALID_STATE_TRANSITION", "Clips were already proposed for this launch");
  const { data: intake } = await service.from("app_intakes").select("target_customer, primary_cta").eq("app_version_id", launch.app_version_id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const proposals = proposeClips(rec.transcript, { audience: intake?.target_customer ?? "", cta: intake?.primary_cta ?? "" });
  if (!proposals.length) throw new AppError("PROCESSING_FAILED", "We couldn't find useful moments in this transcript. Add clips by hand.");
  for (const [i, content] of proposals.entries()) await insertClip(service, launch.organization_id, launchId, rec.id, i + 1, content, user.id);
  return proposals.length;
}

async function insertClip(service: SupabaseClient, orgId: string, launchId: string, recordingId: string | null, position: number, content: ClipContent, userId: string) {
  const { data: clip, error } = await service.from("launch_clips").insert({ organization_id: orgId, launch_id: launchId, recording_id: recordingId, position }).select("id").single();
  if (error || !clip) throw new AppError("INTERNAL_ERROR", error?.message ?? "clip insert failed");
  const { error: vErr } = await service.from("launch_clip_versions").insert({ clip_id: clip.id, launch_id: launchId, organization_id: orgId, version: 1, content, created_by: userId });
  if (vErr) throw new AppError("INTERNAL_ERROR", vErr.message);
}

/** Operator: add a clip by hand (for moments the proposal missed). */
export async function addClip(launchId: string, content: ClipContent) {
  const { service, launch, user, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "operator") throw new AppError("FORBIDDEN", "Our team adds clips");
  const parsed = clipContentSchema.parse(content) as ClipContent;
  const { data: last } = await service.from("launch_clips").select("position").eq("launch_id", launchId).order("position", { ascending: false }).limit(1).maybeSingle();
  const rec = await readyRecording(service, launchId);
  await insertClip(service, launch.organization_id, launchId, rec?.id ?? null, (last?.position ?? 0) + 1, parsed, user.id);
}

/**
 * Any edit writes a new version, which has no reviews, so earlier approvals no longer apply.
 * ASSUMPTION: if timing and aspect are unchanged, the existing export is reused (only copy changed).
 */
export async function editClip(launchId: string, clipId: string, content: ClipContent) {
  const { service, launch, user } = await authorizeLaunch(launchId);
  const parsed = clipContentSchema.parse(content) as ClipContent;
  const prev = await latestVersion(service, launchId, clipId);
  const sameCut = prev.content.startMs === parsed.startMs && prev.content.endMs === parsed.endMs && prev.content.aspect === parsed.aspect && prev.export_status === "ready";
  const { error } = await service.from("launch_clip_versions").insert({
    clip_id: clipId, launch_id: launchId, organization_id: launch.organization_id, version: prev.version + 1, content: parsed, created_by: user.id,
    export_status: sameCut ? "ready" : "not_started", export_path: sameCut ? prev.export_path : null,
  });
  if (error?.code === "23505") throw new AppError("INVALID_STATE_TRANSITION", "Someone else edited this clip at the same time. Reload and try again.");
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
}

export async function dropClip(launchId: string, clipId: string) {
  const { service, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "operator") throw new AppError("FORBIDDEN", "Our team removes clips");
  await service.from("launch_clips").update({ status: "dropped" }).eq("id", clipId).eq("launch_id", launchId);
}

/** Operator uploads the rendered export for the latest version (rendering happens outside the app). */
export async function beginExportUpload(launchId: string, versionId: string, file: { name: string; type: string; size: number }) {
  const { service, launch, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "operator") throw new AppError("FORBIDDEN", "Our team uploads exports");
  if (!/^video\/(mp4|quicktime|webm)$/.test(file.type)) throw new AppError("VALIDATION_FAILED", "Exports must be MP4, MOV or WebM video");
  const v = await versionById(service, launchId, versionId);
  const path = `${launch.organization_id}/${launchId}/exports/${v.clip_id}/v${v.version}-${Date.now()}-${safeObjectName(file.name)}`;
  await service.from("launch_clip_versions").update({ export_status: "rendering", export_error: null }).eq("id", v.id);
  const { data, error } = await service.storage.from(RECORDINGS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    await service.from("launch_clip_versions").update({ export_status: "failed", export_error: "Storage isn't available for uploads." }).eq("id", v.id);
    throw new AppError("PROVIDER_UNAVAILABLE", "Storage isn't available right now. Try again shortly.");
  }
  return { path, token: data.token };
}

export async function completeExportUpload(launchId: string, versionId: string, path: string) {
  const { service, launch, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "operator") throw new AppError("FORBIDDEN", "Our team uploads exports");
  if (!path.startsWith(`${launch.organization_id}/${launchId}/exports/`)) throw new AppError("FORBIDDEN", "That file doesn't belong to this launch");
  const v = await versionById(service, launchId, versionId);
  const dir = path.slice(0, path.lastIndexOf("/")), name = path.slice(path.lastIndexOf("/") + 1);
  const { data: found } = await service.storage.from(RECORDINGS_BUCKET).list(dir, { search: name, limit: 1 });
  const ok = !!found?.some((o) => o.name === name);
  await service.from("launch_clip_versions").update(ok ? { export_status: "ready", export_path: path, export_error: null } : { export_status: "failed", export_error: "The export upload didn't arrive." }).eq("id", v.id);
  if (!ok) throw new AppError("PROCESSING_FAILED", "The export didn't arrive. Upload it again.");
}

export async function failExport(launchId: string, versionId: string, reason: string) {
  const { service, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "operator") throw new AppError("FORBIDDEN", "Our team manages exports");
  const r = reason.trim().slice(0, 500);
  if (!r) throw new AppError("VALIDATION_FAILED", "Say why the export failed");
  const v = await versionById(service, launchId, versionId);
  await service.from("launch_clip_versions").update({ export_status: "failed", export_error: r }).eq("id", v.id);
}

/** Internal review (operator) must precede founder review. Only the newest version can be reviewed. */
export async function reviewClip(launchId: string, versionId: string, decision: Decision, reason: string) {
  const { service, launch, user, actorKind } = await authorizeLaunch(launchId);
  const stage: Stage = actorKind === "operator" ? "internal" : "founder";
  const v = await versionById(service, launchId, versionId);
  const why = reason.trim().slice(0, 1000);
  if (decision !== "approved" && !why) throw new AppError("VALIDATION_FAILED", "Tell us what to change or why you're rejecting it");
  const { data: rv } = await service.from("launch_clip_reviews").select("id, version_id, stage, decision, reason, created_at").eq("launch_id", launchId).order("created_at");
  const all = (rv ?? []) as ReviewRow[];
  if (stage === "founder") {
    const st = versionState(v, all);
    if (decision === "approved") {
      const blockers = founderApprovalBlockers(v, st.internal, v.content, await approvedTruth(service, launchId));
      if (blockers.length) throw new AppError("VALIDATION_FAILED", blockers.join(" "));
    }
    if (decision === "revision_requested") {
      const { data: siblings } = await service.from("launch_clip_versions").select("id").eq("clip_id", v.clip_id);
      const ids = new Set((siblings ?? []).map((s) => s.id));
      if (revisionsUsed(all.filter((r) => ids.has(r.version_id))) >= REVISION_ROUNDS)
        throw new AppError("VALIDATION_FAILED", `This clip has used its ${REVISION_ROUNDS} revision rounds. Message our team to agree any further changes, or edit the copy yourself.`);
    }
  }
  const { error } = await service.from("launch_clip_reviews").insert({
    version_id: v.id, launch_id: launchId, organization_id: launch.organization_id, stage, decision, reason: why || null, reviewer_id: user.id,
  });
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
}

/** Approved, current clip versions: what R6 plans and what the pack's downloads contain. */
export async function approvedClipVersions(service: SupabaseClient, launchId: string) {
  const [{ data: clips }, { data: versions }, { data: reviews }] = await Promise.all([
    service.from("launch_clips").select("id, position").eq("launch_id", launchId).eq("status", "active").order("position"),
    service.from("launch_clip_versions").select(VCOLS).eq("launch_id", launchId).order("version"),
    service.from("launch_clip_reviews").select("version_id, stage, decision").eq("launch_id", launchId).order("created_at"),
  ]);
  const vs = (versions ?? []) as VersionRow[];
  return (clips ?? []).flatMap((c) => {
    const cur = vs.filter((v) => v.clip_id === c.id).at(-1);
    return cur && versionState(cur, (reviews ?? []) as ReviewLike[]).approved ? [{ position: c.position as number, version: cur }] : [];
  });
}
