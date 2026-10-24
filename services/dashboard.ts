import "server-only";
import { AppError } from "@/domain/errors";
import { noLaunchNextAction } from "@/domain/next-action";
import { getUserClient } from "@/lib/supabase/server";
import { getLaunchNextAction } from "@/services/launches";
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

/** Everything the founder home needs, read under RLS as the signed-in user. */
export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await getUserClient();
  if (!supabase) throw new AppError("PROVIDER_UNAVAILABLE", "Supabase is not configured");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new AppError("UNAUTHORIZED", "Sign in required");

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle(),
    supabase
      .from("organization_members")
      .select("organization_id, organizations(name)")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!membership) throw new AppError("FORBIDDEN", "No organization found for this account");
  const orgRel = membership.organizations as { name: string } | { name: string }[] | null;
  const organizationName = (Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name) ?? "Your organization";

  // The most recent open launch drives the panels; fall back to the most recent one of any status.
  const launchQuery = () =>
    supabase
      .from("launches")
      .select("id, status, launch_type, scheduled_at, primary_goal_type, app_id")
      .eq("organization_id", membership.organization_id)
      .order("created_at", { ascending: false })
      .limit(1);
  const { data: openLaunch } = await launchQuery().not("status", "in", "(COMPLETED,CANCELLED)").maybeSingle();
  const launch = openLaunch ?? (await launchQuery().maybeSingle()).data;

  // The launch's app, or the organization's most recent app when there's no launch yet.
  const appQuery = supabase.from("apps").select("id, name, website_url, status").eq("organization_id", membership.organization_id);
  const { data: app } = launch
    ? await appQuery.eq("id", launch.app_id).maybeSingle()
    : await appQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();

  const base = { fullName: profile?.full_name ?? null, organizationName };
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
