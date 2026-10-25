import "server-only";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { apps, launches, profiles } from "@/db/schema";
import { noLaunchNextAction } from "@/domain/next-action";
import { getLaunchNextAction } from "@/services/launches";
import { requireFounder } from "@/services/session";
import type { LaunchStatus, LaunchType, NextAction } from "@/types/launch";

export interface DashboardData {
  fullName: string | null;
  organizationName: string;
  app: { id: string; name: string; websiteUrl: string | null; status: string } | null;
  launch: {
    id: string;
    status: LaunchStatus;
    launchType: LaunchType | null;
    scheduledAt: string | null;
    primaryGoalType: string | null;
  } | null;
  nextAction: NextAction;
}

/** Everything the founder home needs, scoped to the signed-in founder's organization. */
export async function getDashboardData(): Promise<DashboardData> {
  const { db, user, orgId, organizationName } = await requireFounder();
  const [profile] = await db.select({ full_name: profiles.full_name }).from(profiles).where(eq(profiles.id, user.id));

  // The most recent open launch drives the panels; fall back to the most recent one of any status.
  const launchCols = { id: launches.id, status: launches.status, launch_type: launches.launch_type, scheduled_at: launches.scheduled_at, primary_goal_type: launches.primary_goal_type, app_id: launches.app_id };
  const [openLaunch] = await db
    .select(launchCols)
    .from(launches)
    .where(and(eq(launches.organization_id, orgId), notInArray(launches.status, ["COMPLETED", "CANCELLED"])))
    .orderBy(desc(launches.created_at))
    .limit(1);
  const launch =
    openLaunch ??
    (await db.select(launchCols).from(launches).where(eq(launches.organization_id, orgId)).orderBy(desc(launches.created_at)).limit(1))[0];

  // The launch's app, or the organization's most recent app when there's no launch yet.
  const appCols = { id: apps.id, name: apps.name, website_url: apps.website_url, status: apps.status };
  const [app] = launch
    ? await db.select(appCols).from(apps).where(and(eq(apps.organization_id, orgId), eq(apps.id, launch.app_id)))
    : await db.select(appCols).from(apps).where(eq(apps.organization_id, orgId)).orderBy(desc(apps.created_at)).limit(1);

  const base = { fullName: profile?.full_name ?? null, organizationName: organizationName ?? "Your organization" };
  const appOut = app ? { id: app.id, name: app.name, websiteUrl: app.website_url, status: app.status } : null;
  if (!launch) return { ...base, app: appOut, launch: null, nextAction: noLaunchNextAction(Boolean(app)) };

  return {
    ...base,
    app: appOut,
    launch: {
      id: launch.id,
      status: launch.status as LaunchStatus,
      launchType: launch.launch_type as LaunchType | null,
      scheduledAt: launch.scheduled_at,
      primaryGoalType: launch.primary_goal_type,
    },
    nextAction: await getLaunchNextAction(launch.id),
  };
}
