import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { launch_plan_items, tracked_link_clicks, tracked_links } from "@/db/schema";
import { SLUG_RE, clickWindow, metricsFor } from "@/domain/tracked-links";
import { getDb } from "@/lib/db";
import { authorizeLaunch } from "@/services/session";

const newSlug = () => randomBytes(9).toString("base64url");

/** Creates one tracked link per plan item that has a destination and no link yet. */
export async function createLinksForPlan(launchId: string) {
  const { db, launch, user } = await authorizeLaunch(launchId);
  const items = await db.select({ id: launch_plan_items.id, url: launch_plan_items.destination_url, channel: launch_plan_items.channel })
    .from(launch_plan_items).leftJoin(tracked_links, eq(tracked_links.plan_item_id, launch_plan_items.id))
    .where(and(eq(launch_plan_items.launch_id, launchId), isNull(tracked_links.id)));
  const rows = items.filter((i) => i.url).map((i) => ({
    organization_id: launch.organization_id, launch_id: launchId, plan_item_id: i.id, slug: newSlug(), destination_url: i.url!, channel: i.channel, created_by: user.id,
  }));
  if (rows.length) await db.insert(tracked_links).values(rows).onConflictDoNothing();
  return rows.length;
}

export async function getMeasure(launchId: string) {
  const { db } = await authorizeLaunch(launchId);
  const links = await db.select({
    id: tracked_links.id, slug: tracked_links.slug, destination: tracked_links.destination_url, channel: tracked_links.channel, planItemId: tracked_links.plan_item_id,
    clicks: sql<number>`(select count(*)::int from public.tracked_link_clicks c where c.link_id = "tracked_links"."id")`,
  }).from(tracked_links).where(eq(tracked_links.launch_id, launchId)).orderBy(tracked_links.created_at, tracked_links.slug);
  const [{ n: planItems }] = await db.select({ n: sql<number>`count(*)::int` }).from(launch_plan_items).where(eq(launch_plan_items.launch_id, launchId));
  return {
    links, planItems,
    // ASSUMPTION: clicks are "connected" once the launch has at least one tracked link; until then they're unavailable too.
    metrics: metricsFor(links.length ? { clicks: links.reduce((n, l) => n + l.clicks, 0) } : {}),
  };
}

/** ASSUMPTION: visitor hashes are salted with the auth secret (or a dev-only salt outside production). */
function visitorHash(visitorId: string) {
  const salt = process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV === "production" ? "" : "appdemo-dev-click-salt");
  if (!salt) return null;
  return createHmac("sha256", salt).update(visitorId).digest("hex").slice(0, 32);
}

/** Public redirect lookup. No session: the slug is the capability, and only the destination is revealed. */
export async function resolveLink(slug: string) {
  const db = getDb();
  if (!db || !SLUG_RE.test(slug)) return null;
  const [row] = await db.select({ id: tracked_links.id, launchId: tracked_links.launch_id, destination: tracked_links.destination_url })
    .from(tracked_links).where(eq(tracked_links.slug, slug));
  return row ?? null;
}

/** Records a click once per visitor per window. Returns false (never throws) if it couldn't be recorded. */
export async function recordClick(link: { id: string; launchId: string }, visitorId: string, at = new Date()) {
  try {
    const db = getDb();
    const hash = visitorHash(visitorId);
    if (!db || !hash) return false;
    await db.insert(tracked_link_clicks).values({ link_id: link.id, launch_id: link.launchId, visitor_hash: hash, click_window: clickWindow(at), clicked_at: at.toISOString() }).onConflictDoNothing();
    return true;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "tracked_click_failed", error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
