import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { apps, launch_plan_items } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { CHANNELS, OWNERS, POSTING_CHECKLIST, generatePlan, postingBlocker, validPostUrl, type ItemStatus } from "@/domain/promotion-plan";
import { dbErrorCode } from "@/lib/db";
import { approvedClipVersions } from "@/services/content-pack";
import { authorizeLaunch } from "@/services/session";

export const planSetupSchema = z.object({
  channels: z.array(z.object({ channel: z.enum(CHANNELS), owner: z.enum(OWNERS) })).min(1, "Pick at least one channel").max(CHANNELS.length),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
  timezone: z.string().trim().min(1).max(64).refine((tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone"),
});

export async function getPlan(launchId: string) {
  const { db, actorKind } = await authorizeLaunch(launchId);
  const [items, approved] = await Promise.all([
    db.select().from(launch_plan_items).where(eq(launch_plan_items.launch_id, launchId)).orderBy(asc(launch_plan_items.day)),
    approvedClipVersions(db, launchId),
  ]);
  const ok = new Set(approved.map((a) => a.version.id));
  return {
    isOperator: actorKind === "operator", approvedClips: approved.length,
    items: items.map((i) => ({ ...i, blocker: postingBlocker({ status: i.status as ItemStatus }, ok.has(i.clip_version_id)) })),
  };
}

/** Builds the 14-day plan from approved clips. Replaces only items nobody has recorded yet. */
export async function generatePromotionPlan(launchId: string, setup: z.input<typeof planSetupSchema>) {
  const { db, launch } = await authorizeLaunch(launchId);
  const s = planSetupSchema.parse(setup);
  const approved = await approvedClipVersions(db, launchId);
  if (!approved.length) throw new AppError("APPROVAL_REQUIRED", "Approve at least one clip before building the plan");
  const [app] = await db.select({ url: apps.website_url }).from(apps).where(and(eq(apps.id, launch.app_id), eq(apps.organization_id, launch.organization_id)));
  const drafts = generatePlan(approved.map((a) => ({ versionId: a.version.id, position: a.position, version: a.version.version, content: a.version.content })),
    s.channels, s.startDate, app?.url ?? null);
  await db.transaction(async (tx) => {
    const existing = await tx.select({ status: launch_plan_items.status }).from(launch_plan_items).where(eq(launch_plan_items.launch_id, launchId));
    if (existing.some((e) => e.status !== "planned" && e.status !== "skipped"))
      throw new AppError("INVALID_STATE_TRANSITION", "Posts were already recorded on this plan, so it can't be rebuilt");
    await tx.delete(launch_plan_items).where(eq(launch_plan_items.launch_id, launchId));
    await tx.insert(launch_plan_items).values(drafts.map((d) => ({
      organization_id: launch.organization_id, launch_id: launchId, clip_version_id: d.clipVersionId, day: d.day, planned_date: d.plannedDate,
      planned_time: d.plannedTime, timezone: s.timezone, channel: d.channel, channel_owner: d.owner, responsible: d.responsible,
      audience: d.audience, objective: d.objective, post_copy: d.postCopy, destination_url: d.destinationUrl,
    })));
  });
  return drafts.length;
}

async function item(launchId: string, itemId: string, allow?: Array<"founder" | "operator">) {
  const ctx = await authorizeLaunch(launchId, allow);
  const [row] = await ctx.db.select().from(launch_plan_items).where(and(eq(launch_plan_items.id, itemId), eq(launch_plan_items.launch_id, launchId)));
  if (!row) throw new AppError("NOT_FOUND", "Plan item not found");
  return { ...ctx, row };
}

/** Founder (or team, for AppDemo channels) records that they posted. Self-reported until the team confirms it. */
export async function recordPost(launchId: string, itemId: string, postedUrl: string, checked: string[]) {
  const { db, user, row } = await item(launchId, itemId);
  const url = postedUrl.trim();
  if (!validPostUrl(url)) throw new AppError("VALIDATION_FAILED", "Paste the link to the live post");
  if (POSTING_CHECKLIST.some((c) => !checked.includes(c.id))) throw new AppError("VALIDATION_FAILED", "Tick every step of the checklist first");
  const approved = new Set((await approvedClipVersions(db, launchId)).map((a) => a.version.id));
  const blocker = postingBlocker({ status: row.status as ItemStatus }, approved.has(row.clip_version_id));
  if (blocker) throw new AppError("INVALID_STATE_TRANSITION", blocker);
  try {
    const done = await db.update(launch_plan_items).set({ status: "posted_self_reported", posted_url: url, posted_at: new Date().toISOString(), reported_by: user.id })
      .where(and(eq(launch_plan_items.id, row.id), eq(launch_plan_items.status, "planned"))).returning({ id: launch_plan_items.id });
    if (!done.length) throw new AppError("INVALID_STATE_TRANSITION", "This item was already recorded.");
  } catch (e) {
    if (dbErrorCode(e) === "23505") throw new AppError("VALIDATION_FAILED", "That post link is already recorded on another item");
    throw e;
  }
}

/** Team checks the live post independently, then confirms it. */
export async function confirmPost(launchId: string, itemId: string) {
  const { db, user, row, actorKind } = await item(launchId, itemId);
  if (actorKind !== "operator") throw new AppError("FORBIDDEN", "Our team confirms posts after checking them");
  const done = await db.update(launch_plan_items).set({ status: "confirmed", confirmed_by: user.id, confirmed_at: new Date().toISOString() })
    .where(and(eq(launch_plan_items.id, row.id), eq(launch_plan_items.status, "posted_self_reported"))).returning({ id: launch_plan_items.id });
  if (!done.length) throw new AppError("INVALID_STATE_TRANSITION", "Only a reported post can be confirmed");
}

export async function skipItem(launchId: string, itemId: string) {
  const { db, row } = await item(launchId, itemId);
  const done = await db.update(launch_plan_items).set({ status: "skipped" })
    .where(and(eq(launch_plan_items.id, row.id), eq(launch_plan_items.status, "planned"))).returning({ id: launch_plan_items.id });
  if (!done.length) throw new AppError("INVALID_STATE_TRANSITION", "Only a planned item can be skipped");
}
