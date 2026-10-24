import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError } from "@/domain/errors";
import { TRUTH_CATEGORIES, TRUTH_KINDS, approvalBlockers, draftTruthSheet, type TruthItem } from "@/domain/truth-sheet";
import { authorizeLaunch } from "@/services/preparation";

export const truthItemSchema = z.object({
  category: z.enum(TRUTH_CATEGORIES),
  kind: z.enum(TRUTH_KINDS),
  statement: z.string().trim().min(1, "Each line needs a statement").max(1000),
  evidenceUrl: z.string().trim().max(500).refine((v) => v === "" || /^https?:\/\/\S+\.\S+/.test(v), "Evidence links must start with https://").transform((v) => v || null).nullish(),
  evidenceNote: z.string().trim().max(1000).transform((v) => v || null).nullish(),
});
export const truthItemsSchema = z.array(truthItemSchema).max(80, "A truth sheet can have at most 80 lines");

export interface TruthSheetRow { id: string; version: number; status: string; items: TruthItem[]; source: string; approved_at: string | null; created_at: string }

async function latest(service: SupabaseClient, launchId: string) {
  const { data, error } = await service.from("launch_truth_sheets").select("id, version, status, items, source, approved_at, created_at")
    .eq("launch_id", launchId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
  return data as TruthSheetRow | null;
}

/** Latest version plus the approved one (they differ while a correction is in draft). */
export async function getTruthSheet(launchId: string) {
  const { service } = await authorizeLaunch(launchId);
  const current = await latest(service, launchId);
  const { data: approved } = await service.from("launch_truth_sheets").select("id, version, status, items, source, approved_at, created_at")
    .eq("launch_id", launchId).eq("status", "approved").maybeSingle();
  return { current, approved: (approved as TruthSheetRow | null) ?? null, blockers: current ? approvalBlockers(current.items) : [] };
}

/** First draft from the founder's intake and the AI analysis. Does nothing if a sheet exists. */
export async function startTruthSheet(launchId: string) {
  const { service, launch, user } = await authorizeLaunch(launchId);
  if (await latest(service, launchId)) return;
  const [{ data: app }, { data: intake }, { data: pu }] = await Promise.all([
    service.from("apps").select("name, website_url").eq("id", launch.app_id).single(),
    service.from("app_intakes").select("*").eq("app_version_id", launch.app_version_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    service.from("product_understandings").select("output").eq("app_version_id", launch.app_version_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const items = draftTruthSheet({
    appName: app?.name ?? "", websiteUrl: app?.website_url ?? null,
    founderDescription: intake?.founder_description ?? null, targetCustomer: intake?.target_customer ?? null,
    problemSolved: intake?.problem_solved ?? null, desiredOutcome: intake?.desired_outcome ?? null,
    pricingSummary: intake?.pricing_summary ?? null, primaryCta: intake?.primary_cta ?? null,
  }, (pu?.output as Record<string, string[]> | null) ?? null);
  const { error } = await service.from("launch_truth_sheets").insert({
    organization_id: launch.organization_id, launch_id: launchId, version: 1, items, source: "intake", created_by: user.id,
  });
  if (error && error.code !== "23505") throw new AppError("INTERNAL_ERROR", error.message);
}

/** Saving never overwrites: it writes a new draft version. Approval stays on the old version until re-approved. */
export async function saveTruthSheet(launchId: string, items: TruthItem[]) {
  const { service, launch, user, actorKind } = await authorizeLaunch(launchId);
  const parsed = truthItemsSchema.parse(items);
  const prev = await latest(service, launchId);
  const { error } = await service.from("launch_truth_sheets").insert({
    organization_id: launch.organization_id, launch_id: launchId, version: (prev?.version ?? 0) + 1, items: parsed,
    source: actorKind === "operator" ? "operator" : "founder", created_by: user.id,
  });
  if (error?.code === "23505") throw new AppError("INVALID_STATE_TRANSITION", "Someone else saved at the same time. Reload and try again.");
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
  if (prev && prev.status === "draft") await service.from("launch_truth_sheets").update({ status: "superseded" }).eq("id", prev.id);
}

/** The founder approves the latest version. Blocked while required facts are missing or offers lack evidence. */
export async function approveTruthSheet(launchId: string) {
  const { service, user, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "founder") throw new AppError("FORBIDDEN", "Only the founder approves the truth sheet");
  const cur = await latest(service, launchId);
  if (!cur) throw new AppError("NOT_FOUND", "There is no truth sheet yet");
  if (cur.status === "approved") return;
  const blockers = approvalBlockers(cur.items);
  if (blockers.length) throw new AppError("VALIDATION_FAILED", blockers.join(" "));
  await service.from("launch_truth_sheets").update({ status: "superseded" }).eq("launch_id", launchId).eq("status", "approved");
  const { error } = await service.from("launch_truth_sheets").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", cur.id);
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
}
