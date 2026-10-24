import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { app_intakes, apps, launch_truth_sheets, product_understandings } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { TRUTH_CATEGORIES, TRUTH_KINDS, approvalBlockers, draftTruthSheet, type TruthItem } from "@/domain/truth-sheet";
import { dbErrorCode, type Db } from "@/lib/db";
import { authorizeLaunch } from "@/services/session";

export const truthItemSchema = z.object({
  category: z.enum(TRUTH_CATEGORIES),
  kind: z.enum(TRUTH_KINDS),
  statement: z.string().trim().min(1, "Each line needs a statement").max(1000),
  evidenceUrl: z.string().trim().max(500).refine((v) => v === "" || /^https?:\/\/\S+\.\S+/.test(v), "Evidence links must start with https://").transform((v) => v || null).nullish(),
  evidenceNote: z.string().trim().max(1000).transform((v) => v || null).nullish(),
});
export const truthItemsSchema = z.array(truthItemSchema).max(80, "A truth sheet can have at most 80 lines");

export interface TruthSheetRow { id: string; version: number; status: string; items: TruthItem[]; source: string; approved_at: string | null; created_at: string }

const cols = {
  id: launch_truth_sheets.id, version: launch_truth_sheets.version, status: launch_truth_sheets.status, items: launch_truth_sheets.items,
  source: launch_truth_sheets.source, approved_at: launch_truth_sheets.approved_at, created_at: launch_truth_sheets.created_at,
};

/** Every query below is scoped to a launch that authorizeLaunch has already checked. */
export async function latestTruthSheet(db: Db, launchId: string): Promise<TruthSheetRow | null> {
  const [row] = await db.select(cols).from(launch_truth_sheets).where(eq(launch_truth_sheets.launch_id, launchId)).orderBy(desc(launch_truth_sheets.version)).limit(1);
  return (row as TruthSheetRow | undefined) ?? null;
}
export async function approvedTruthSheet(db: Db, launchId: string): Promise<TruthSheetRow | null> {
  const [row] = await db.select(cols).from(launch_truth_sheets).where(and(eq(launch_truth_sheets.launch_id, launchId), eq(launch_truth_sheets.status, "approved")));
  return (row as TruthSheetRow | undefined) ?? null;
}

/** Latest version plus the approved one (they differ while a correction is in draft). */
export async function getTruthSheet(launchId: string) {
  const { db } = await authorizeLaunch(launchId);
  const current = await latestTruthSheet(db, launchId);
  return { current, approved: await approvedTruthSheet(db, launchId), blockers: current ? approvalBlockers(current.items) : [] };
}

/** First draft from the founder's intake and the AI analysis. Does nothing if a sheet exists. */
export async function startTruthSheet(launchId: string) {
  const { db, launch, user } = await authorizeLaunch(launchId);
  if (await latestTruthSheet(db, launchId)) return;
  const [[app], [intake], [pu]] = await Promise.all([
    db.select({ name: apps.name, website_url: apps.website_url }).from(apps).where(and(eq(apps.id, launch.app_id), eq(apps.organization_id, launch.organization_id))),
    db.select().from(app_intakes).where(and(eq(app_intakes.app_version_id, launch.app_version_id), eq(app_intakes.organization_id, launch.organization_id))).orderBy(desc(app_intakes.created_at)).limit(1),
    db.select({ output: product_understandings.output }).from(product_understandings).where(and(eq(product_understandings.app_version_id, launch.app_version_id), eq(product_understandings.organization_id, launch.organization_id))).orderBy(desc(product_understandings.created_at)).limit(1),
  ]);
  const items = draftTruthSheet({
    appName: app?.name ?? "", websiteUrl: app?.website_url ?? null,
    founderDescription: intake?.founder_description ?? null, targetCustomer: intake?.target_customer ?? null,
    problemSolved: intake?.problem_solved ?? null, desiredOutcome: intake?.desired_outcome ?? null,
    pricingSummary: intake?.pricing_summary ?? null, primaryCta: intake?.primary_cta ?? null,
  }, (pu?.output as Record<string, string[]> | null) ?? null);
  try {
    await db.insert(launch_truth_sheets).values({ organization_id: launch.organization_id, launch_id: launchId, version: 1, items, source: "intake", created_by: user.id });
  } catch (e) {
    if (dbErrorCode(e) !== "23505") throw e;
  }
}

/** Saving never overwrites: it writes a new draft version. Approval stays on the old version until re-approved. */
export async function saveTruthSheet(launchId: string, items: TruthItem[]) {
  const { db, launch, user, actorKind } = await authorizeLaunch(launchId);
  const parsed = truthItemsSchema.parse(items);
  await db.transaction(async (tx) => {
    const prev = await latestTruthSheet(tx as unknown as Db, launchId);
    try {
      await tx.insert(launch_truth_sheets).values({
        organization_id: launch.organization_id, launch_id: launchId, version: (prev?.version ?? 0) + 1, items: parsed,
        source: actorKind === "operator" ? "operator" : "founder", created_by: user.id,
      });
    } catch (e) {
      if (dbErrorCode(e) === "23505") throw new AppError("INVALID_STATE_TRANSITION", "Someone else saved at the same time. Reload and try again.");
      throw e;
    }
    if (prev && prev.status === "draft") await tx.update(launch_truth_sheets).set({ status: "superseded" }).where(eq(launch_truth_sheets.id, prev.id));
  });
}

/** The founder approves the latest version. Blocked while required facts are missing or offers lack evidence. */
export async function approveTruthSheet(launchId: string) {
  const { db, user, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "founder") throw new AppError("FORBIDDEN", "Only the founder approves the truth sheet");
  const cur = await latestTruthSheet(db, launchId);
  if (!cur) throw new AppError("NOT_FOUND", "There is no truth sheet yet");
  if (cur.status === "approved") return;
  const blockers = approvalBlockers(cur.items);
  if (blockers.length) throw new AppError("VALIDATION_FAILED", blockers.join(" "));
  await db.transaction(async (tx) => {
    await tx.update(launch_truth_sheets).set({ status: "superseded" }).where(and(eq(launch_truth_sheets.launch_id, launchId), eq(launch_truth_sheets.status, "approved")));
    await tx.update(launch_truth_sheets).set({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).where(and(eq(launch_truth_sheets.id, cur.id), eq(launch_truth_sheets.launch_id, launchId)));
  });
}
