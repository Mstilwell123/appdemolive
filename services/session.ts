import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { launches, organization_members, organizations, platform_staff } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { requireDb, type Db } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/session-user";

const STAFF_ROLES = ["admin", "operator"];

/** The signed-in user. Every service entry point goes through here or one of the helpers below. */
export async function requireUser(): Promise<{ db: Db; user: SessionUser }> {
  const db = requireDb();
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHORIZED", "Sign in required");
  return { db, user };
}

/** The signed-in founder and their (first) organization. Founder queries must filter by orgId. */
export async function requireFounder() {
  const { db, user } = await requireUser();
  const [membership] = await db
    .select({ orgId: organization_members.organization_id, name: organizations.name })
    .from(organization_members)
    .innerJoin(organizations, eq(organizations.id, organization_members.organization_id))
    .where(eq(organization_members.user_id, user.id))
    .orderBy(asc(organization_members.created_at))
    .limit(1);
  if (!membership) throw new AppError("FORBIDDEN", "No organization found for this account");
  return { db, user, orgId: membership.orgId, organizationName: membership.name };
}

async function isStaff(db: Db, userId: string) {
  const [staff] = await db.select({ role: platform_staff.role }).from(platform_staff).where(eq(platform_staff.user_id, userId));
  return Boolean(staff && STAFF_ROLES.includes(staff.role));
}

async function isMember(db: Db, orgId: string, userId: string) {
  const [m] = await db
    .select({ id: organization_members.id })
    .from(organization_members)
    .where(and(eq(organization_members.organization_id, orgId), eq(organization_members.user_id, userId)));
  return Boolean(m);
}

/** Platform staff (admin or operator), checked server-side against platform_staff. Others get NOT_FOUND. */
export async function requireOperator() {
  const { db, user } = await requireUser();
  if (!(await isStaff(db, user.id))) throw new AppError("NOT_FOUND", "Not found");
  return { db, user };
}

/** The signed-in user must be a member of orgId (optionally with one of roles). Others get NOT_FOUND. */
export async function authorizeOrg(orgId: string, roles?: string[]) {
  const { db, user } = await requireUser();
  const [m] = await db
    .select({ role: organization_members.role })
    .from(organization_members)
    .where(and(eq(organization_members.organization_id, orgId), eq(organization_members.user_id, user.id)));
  if (!m || (roles && !roles.includes(m.role))) throw new AppError("NOT_FOUND", "Not found");
  return { db, user, orgId, role: m.role };
}

/**
 * The signed-in caller must belong to the launch's organization (founder) or be platform staff
 * (operator). Anyone else gets NOT_FOUND so other organizations' launches stay invisible.
 */
export async function authorizeLaunch(launchId: string, allow: Array<"founder" | "operator"> = ["founder", "operator"]) {
  const { db, user } = await requireUser();
  const [launch] = await db
    .select({
      id: launches.id,
      organization_id: launches.organization_id,
      app_id: launches.app_id,
      app_version_id: launches.app_version_id,
      status: launches.status,
      launch_type: launches.launch_type,
    })
    .from(launches)
    .where(eq(launches.id, launchId));
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");
  const [member, staff] = await Promise.all([isMember(db, launch.organization_id, user.id), isStaff(db, user.id)]);
  const actorKind = member && allow.includes("founder") ? "founder" : staff && allow.includes("operator") ? "operator" : null;
  if (!actorKind) throw new AppError("NOT_FOUND", "Launch not found");
  return { db, user, launch, actorKind: actorKind as "founder" | "operator" };
}

/** Organization ids the user belongs to. */
export async function memberOrgIds(db: Db, userId: string) {
  const rows = await db.select({ id: organization_members.organization_id }).from(organization_members).where(eq(organization_members.user_id, userId));
  return rows.map((r) => r.id);
}


/** For operator pages: whether the visitor is signed out, not staff (shown a plain 404) or staff. */
export async function operatorAccess(): Promise<"signed_out" | "denied" | "ok"> {
  const db = requireDb();
  const user = await getSessionUser();
  if (!user) return "signed_out";
  return (await isStaff(db, user.id)) ? "ok" : "denied";
}
