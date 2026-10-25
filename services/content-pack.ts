import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { app_intakes, launch_clip_reviews, launch_clip_versions, launch_clips, launch_recordings } from "@/db/schema";
import {
  ASPECTS, PLACEMENTS, REVISION_ROUNDS, founderApprovalBlockers, proposeClips, revisionsUsed, versionState,
  type ClipContent, type Decision, type ExportStatus, type ReviewLike, type Stage,
} from "@/domain/content-pack";
import { AppError } from "@/domain/errors";
import { recordingComplete, safeObjectName, type RecordingLike, type TranscriptSegment } from "@/domain/recording";
import type { TruthItem } from "@/domain/truth-sheet";
import { getStorage } from "@/integrations/storage";
import { dbErrorCode, type Db } from "@/lib/db";
import { authorizeLaunch } from "@/services/session";
import { approvedTruthSheet } from "@/services/truth-sheet";

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
const VCOLS = {
  id: launch_clip_versions.id, clip_id: launch_clip_versions.clip_id, version: launch_clip_versions.version, content: launch_clip_versions.content,
  export_status: launch_clip_versions.export_status, export_path: launch_clip_versions.export_path, export_error: launch_clip_versions.export_error,
  created_at: launch_clip_versions.created_at,
};
const RCOLS = {
  id: launch_clip_reviews.id, version_id: launch_clip_reviews.version_id, stage: launch_clip_reviews.stage, decision: launch_clip_reviews.decision,
  reason: launch_clip_reviews.reason, created_at: launch_clip_reviews.created_at,
};
const operatorOnly = (actorKind: string, what: string) => { if (actorKind !== "operator") throw new AppError("FORBIDDEN", what); };

async function approvedTruth(db: Db, launchId: string) {
  return ((await approvedTruthSheet(db, launchId))?.items as TruthItem[] | undefined) ?? null;
}

export async function readyRecording(db: Db, launchId: string) {
  const [row] = await db.select({ id: launch_recordings.id, status: launch_recordings.status, storage_path: launch_recordings.storage_path,
    transcript: launch_recordings.transcript, updated_at: launch_recordings.updated_at, original_filename: launch_recordings.original_filename })
    .from(launch_recordings).where(and(eq(launch_recordings.launch_id, launchId), eq(launch_recordings.status, "ready")))
    .orderBy(desc(launch_recordings.created_at)).limit(1);
  return row && recordingComplete(row as RecordingLike)
    ? row as { id: string; storage_path: string; transcript: TranscriptSegment[]; original_filename: string | null } : null;
}

async function latestVersion(db: Db, launchId: string, clipId: string) {
  const [row] = await db.select(VCOLS).from(launch_clip_versions)
    .where(and(eq(launch_clip_versions.launch_id, launchId), eq(launch_clip_versions.clip_id, clipId))).orderBy(desc(launch_clip_versions.version)).limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Clip not found");
  return row as VersionRow;
}

async function versionById(db: Db, launchId: string, versionId: string) {
  const [row] = await db.select(VCOLS).from(launch_clip_versions).where(and(eq(launch_clip_versions.launch_id, launchId), eq(launch_clip_versions.id, versionId)));
  if (!row) throw new AppError("NOT_FOUND", "Clip version not found");
  const latest = await latestVersion(db, launchId, row.clip_id);
  if (latest.id !== row.id) throw new AppError("INVALID_STATE_TRANSITION", "This clip was edited since you opened it. Review the newest version.");
  return row as VersionRow;
}

async function allVersions(db: Db, launchId: string) {
  return (await db.select(VCOLS).from(launch_clip_versions).where(eq(launch_clip_versions.launch_id, launchId)).orderBy(asc(launch_clip_versions.version))) as VersionRow[];
}
async function allReviews(db: Db, launchId: string) {
  return (await db.select(RCOLS).from(launch_clip_reviews).where(eq(launch_clip_reviews.launch_id, launchId)).orderBy(asc(launch_clip_reviews.created_at))) as ReviewRow[];
}

/** Everything the founder needs in one place: recording, transcript, clips with state, and download links. */
export async function getContentPack(launchId: string) {
  const { db, actorKind } = await authorizeLaunch(launchId);
  const [clips, versions, reviews, truth, recording] = await Promise.all([
    db.select({ id: launch_clips.id, position: launch_clips.position, status: launch_clips.status }).from(launch_clips)
      .where(eq(launch_clips.launch_id, launchId)).orderBy(asc(launch_clips.position)),
    allVersions(db, launchId), allReviews(db, launchId), approvedTruth(db, launchId), readyRecording(db, launchId),
  ]);
  const storage = getStorage();
  const sign = async (p: string | null) => (p && storage ? storage.downloadUrl(p, 3600) : null);
  const items = await Promise.all(clips.filter((c) => c.status === "active").flatMap((c) => {
    const vs = versions.filter((v) => v.clip_id === c.id);
    const current = vs.at(-1);
    if (!current) return [];
    const vIds = new Set(vs.map((v) => v.id));
    const clipReviews = reviews.filter((r) => vIds.has(r.version_id));
    const state = versionState(current, clipReviews);
    return [(async () => ({
      id: c.id, position: c.position, current, versions: vs.length, reviews: clipReviews, state,
      revisionsUsed: revisionsUsed(clipReviews),
      blockers: founderApprovalBlockers(current, state.internal, current.content, truth),
      exportUrl: current.export_status === "ready" ? await sign(current.export_path) : null,
    }))()];
  }));
  return {
    clips: items, isOperator: actorKind === "operator", truthApproved: !!truth,
    recording: recording ? { id: recording.id, name: recording.original_filename, url: await sign(recording.storage_path), segments: recording.transcript.length } : null,
  };
}

async function insertClip(db: Db, orgId: string, launchId: string, recordingId: string | null, position: number, content: ClipContent, userId: string) {
  await db.transaction(async (tx) => {
    const [clip] = await tx.insert(launch_clips).values({ organization_id: orgId, launch_id: launchId, recording_id: recordingId, position }).returning({ id: launch_clips.id });
    await tx.insert(launch_clip_versions).values({ clip_id: clip.id, launch_id: launchId, organization_id: orgId, version: 1, content, created_by: userId });
  });
}

/** Operator: propose candidates from the ready recording. Needs an approved truth sheet. Runs once. */
export async function proposeContentPack(launchId: string) {
  const { db, launch, user, actorKind } = await authorizeLaunch(launchId);
  operatorOnly(actorKind, "Our team proposes the clips");
  if (!(await approvedTruth(db, launchId))) throw new AppError("APPROVAL_REQUIRED", "The founder needs to approve the truth sheet first");
  const rec = await readyRecording(db, launchId);
  if (!rec) throw new AppError("INVALID_STATE_TRANSITION", "There's no recording with a transcript yet");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(launch_clips).where(eq(launch_clips.launch_id, launchId));
  if (n) throw new AppError("INVALID_STATE_TRANSITION", "Clips were already proposed for this launch");
  const [intake] = await db.select({ target_customer: app_intakes.target_customer, primary_cta: app_intakes.primary_cta }).from(app_intakes)
    .where(and(eq(app_intakes.app_version_id, launch.app_version_id), eq(app_intakes.organization_id, launch.organization_id)))
    .orderBy(desc(app_intakes.created_at)).limit(1);
  const proposals = proposeClips(rec.transcript, { audience: intake?.target_customer ?? "", cta: intake?.primary_cta ?? "" });
  if (!proposals.length) throw new AppError("PROCESSING_FAILED", "We couldn't find useful moments in this transcript. Add clips by hand.");
  for (const [i, content] of proposals.entries()) await insertClip(db, launch.organization_id, launchId, rec.id, i + 1, content, user.id);
  return proposals.length;
}

/** Operator: add a clip by hand (for moments the proposal missed). */
export async function addClip(launchId: string, content: ClipContent) {
  const { db, launch, user, actorKind } = await authorizeLaunch(launchId);
  operatorOnly(actorKind, "Our team adds clips");
  const parsed = clipContentSchema.parse(content) as ClipContent;
  const [last] = await db.select({ position: launch_clips.position }).from(launch_clips).where(eq(launch_clips.launch_id, launchId)).orderBy(desc(launch_clips.position)).limit(1);
  const rec = await readyRecording(db, launchId);
  await insertClip(db, launch.organization_id, launchId, rec?.id ?? null, (last?.position ?? 0) + 1, parsed, user.id);
}

/**
 * Any edit writes a new version, which has no reviews, so earlier approvals no longer apply.
 * ASSUMPTION: if timing and aspect are unchanged, the existing export is reused (only copy changed).
 */
export async function editClip(launchId: string, clipId: string, content: ClipContent) {
  const { db, launch, user } = await authorizeLaunch(launchId);
  const parsed = clipContentSchema.parse(content) as ClipContent;
  const prev = await latestVersion(db, launchId, clipId);
  const sameCut = prev.content.startMs === parsed.startMs && prev.content.endMs === parsed.endMs && prev.content.aspect === parsed.aspect && prev.export_status === "ready";
  try {
    await db.insert(launch_clip_versions).values({
      clip_id: clipId, launch_id: launchId, organization_id: launch.organization_id, version: prev.version + 1, content: parsed, created_by: user.id,
      export_status: sameCut ? "ready" : "not_started", export_path: sameCut ? prev.export_path : null,
    });
  } catch (e) {
    if (dbErrorCode(e) === "23505") throw new AppError("INVALID_STATE_TRANSITION", "Someone else edited this clip at the same time. Reload and try again.");
    throw e;
  }
}

export async function dropClip(launchId: string, clipId: string) {
  const { db, actorKind } = await authorizeLaunch(launchId);
  operatorOnly(actorKind, "Our team removes clips");
  const rows = await db.update(launch_clips).set({ status: "dropped" })
    .where(and(eq(launch_clips.id, clipId), eq(launch_clips.launch_id, launchId))).returning({ id: launch_clips.id });
  if (!rows.length) throw new AppError("NOT_FOUND", "Clip not found");
}

/**
 * Operator uploads the rendered export for the latest version (rendering happens outside the app).
 * The server picks the object key and pins it on the version while it's "rendering".
 */
export async function beginExportUpload(launchId: string, versionId: string, file: { name: string; type: string; size: number }) {
  const { db, launch, actorKind } = await authorizeLaunch(launchId);
  operatorOnly(actorKind, "Our team uploads exports");
  if (!/^video\/(mp4|quicktime|webm)$/.test(file.type)) throw new AppError("VALIDATION_FAILED", "Exports must be MP4, MOV or WebM video");
  if (!(file.size > 0) || file.size > 2 * 1024 * 1024 * 1024) throw new AppError("VALIDATION_FAILED", "Exports must be between 1 byte and 2 GB");
  const v = await versionById(db, launchId, versionId);
  const storage = getStorage();
  const path = `${launch.organization_id}/${launchId}/exports/${v.clip_id}/v${v.version}-${Date.now()}-${safeObjectName(file.name)}`;
  if (!storage) {
    await db.update(launch_clip_versions).set({ export_status: "failed", export_error: "Storage isn't available for uploads." }).where(eq(launch_clip_versions.id, v.id));
    throw new AppError("PROVIDER_UNAVAILABLE", "Storage isn't available right now. Try again shortly.");
  }
  await db.update(launch_clip_versions).set({ export_status: "rendering", export_path: path, export_error: null }).where(eq(launch_clip_versions.id, v.id));
  return { upload: await storage.createUploadTarget(path, file.type, file.size) };
}

export async function completeExportUpload(launchId: string, versionId: string) {
  const { db, actorKind } = await authorizeLaunch(launchId);
  operatorOnly(actorKind, "Our team uploads exports");
  const v = await versionById(db, launchId, versionId);
  if (v.export_status !== "rendering" || !v.export_path) throw new AppError("INVALID_STATE_TRANSITION", "Start the export upload again.");
  const storage = getStorage();
  const found = storage ? await storage.exists(v.export_path) : null;
  const typeOk = !found?.contentType || /^video\/(mp4|quicktime|webm)$/.test(found.contentType);
  if (found && (!typeOk || found.size > 2 * 1024 * 1024 * 1024)) await storage?.remove(v.export_path);
  const ok = !!found && typeOk && found.size <= 2 * 1024 * 1024 * 1024;
  await db.update(launch_clip_versions)
    .set(ok ? { export_status: "ready", export_error: null } : { export_status: "failed", export_path: null, export_error: "The export upload didn't arrive." })
    .where(and(eq(launch_clip_versions.id, v.id), eq(launch_clip_versions.export_status, "rendering")));
  if (!ok) throw new AppError("PROCESSING_FAILED", "The export didn't arrive. Upload it again.");
}

export async function failExport(launchId: string, versionId: string, reason: string) {
  const { db, actorKind } = await authorizeLaunch(launchId);
  operatorOnly(actorKind, "Our team manages exports");
  const r = reason.trim().slice(0, 500);
  if (!r) throw new AppError("VALIDATION_FAILED", "Say why the export failed");
  const v = await versionById(db, launchId, versionId);
  await db.update(launch_clip_versions).set({ export_status: "failed", export_path: null, export_error: r }).where(eq(launch_clip_versions.id, v.id));
}

/** Internal review (operator) must precede founder review. Only the newest version can be reviewed. */
export async function reviewClip(launchId: string, versionId: string, decision: Decision, reason: string) {
  const { db, launch, user, actorKind } = await authorizeLaunch(launchId);
  const stage: Stage = actorKind === "operator" ? "internal" : "founder";
  const v = await versionById(db, launchId, versionId);
  const why = reason.trim().slice(0, 1000);
  if (decision !== "approved" && !why) throw new AppError("VALIDATION_FAILED", "Tell us what to change or why you're rejecting it");
  const all = await allReviews(db, launchId);
  if (stage === "founder") {
    const st = versionState(v, all);
    if (decision === "approved") {
      const blockers = founderApprovalBlockers(v, st.internal, v.content, await approvedTruth(db, launchId));
      if (blockers.length) throw new AppError("VALIDATION_FAILED", blockers.join(" "));
    }
    if (decision === "revision_requested") {
      const siblings = await db.select({ id: launch_clip_versions.id }).from(launch_clip_versions)
        .where(and(eq(launch_clip_versions.clip_id, v.clip_id), eq(launch_clip_versions.launch_id, launchId)));
      const ids = new Set(siblings.map((s) => s.id));
      if (revisionsUsed(all.filter((r) => ids.has(r.version_id))) >= REVISION_ROUNDS)
        throw new AppError("VALIDATION_FAILED", `This clip has used its ${REVISION_ROUNDS} revision rounds. Message our team to agree any further changes, or edit the copy yourself.`);
    }
  }
  await db.insert(launch_clip_reviews).values({
    version_id: v.id, launch_id: launchId, organization_id: launch.organization_id, stage, decision, reason: why || null, reviewer_id: user.id,
  });
}

/** Approved, current clip versions: what R6 plans and what the pack's downloads contain. Callers must have authorized the launch. */
export async function approvedClipVersions(db: Db, launchId: string) {
  const [clips, versions, reviews] = await Promise.all([
    db.select({ id: launch_clips.id, position: launch_clips.position }).from(launch_clips)
      .where(and(eq(launch_clips.launch_id, launchId), eq(launch_clips.status, "active"))).orderBy(asc(launch_clips.position)),
    allVersions(db, launchId), allReviews(db, launchId),
  ]);
  return clips.flatMap((c) => {
    const cur = versions.filter((v) => v.clip_id === c.id).at(-1);
    return cur && versionState(cur, reviews).approved ? [{ clipId: c.id, position: c.position, version: cur }] : [];
  });
}
