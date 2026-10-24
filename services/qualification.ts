import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { app_intakes, app_versions, apps, launches, organizations, profiles, qualification_events, qualifications } from "@/db/schema";
import { AppError, fromDbError } from "@/domain/errors";
import { DECISION_TO_STATUS } from "@/domain/qualification";
import { dbErrorMessage, queryRows } from "@/lib/db";
import type { AreaStatus, Decision, QualificationArea } from "@/schemas/qualification";
import { applyTransition } from "@/services/launches";
import { requireOperator } from "@/services/session";

/** Operator queue (§9): open reviews, oldest first, with their app and version. */
export async function listQualificationQueue() {
  const { db } = await requireOperator();
  const rows = await db
    .select({
      id: qualifications.id, status: qualifications.status, organization_id: qualifications.organization_id, app_version_id: qualifications.app_version_id,
      launch_id: qualifications.launch_id, created_at: qualifications.created_at, reviewer_id: qualifications.reviewer_id,
      versionLabel: app_versions.version_label, appName: apps.name, appUrl: apps.website_url, orgName: organizations.name,
    })
    .from(qualifications)
    .leftJoin(app_versions, eq(app_versions.id, qualifications.app_version_id))
    .leftJoin(apps, eq(apps.id, app_versions.app_id))
    .leftJoin(organizations, eq(organizations.id, qualifications.organization_id))
    .where(inArray(qualifications.status, ["pending", "in_review"]))
    .orderBy(asc(qualifications.created_at));
  return rows.map((r) => ({ ...r, versionLabel: r.versionLabel ?? "?", appName: r.appName ?? "Unknown app", appUrl: r.appUrl ?? null, orgName: r.orgName ?? "" }));
}

export async function getQualificationReview(id: string) {
  const { db } = await requireOperator();
  const [q] = await db.select().from(qualifications).where(eq(qualifications.id, id));
  if (!q) throw new AppError("NOT_FOUND", "Review not found");
  const [versionRows, intakeRows, events, orgRows, versionLaunches] = await Promise.all([
    db
      .select({
        version: app_versions,
        app: { id: apps.id, name: apps.name, website_url: apps.website_url, description: apps.description, category: apps.category, business_type: apps.business_type },
      })
      .from(app_versions)
      .innerJoin(apps, eq(apps.id, app_versions.app_id))
      .where(eq(app_versions.id, q.app_version_id)),
    db.select().from(app_intakes).where(eq(app_intakes.app_version_id, q.app_version_id)).orderBy(desc(app_intakes.created_at)).limit(1),
    db
      .select({ id: qualification_events.id, area: qualification_events.area, status: qualification_events.status, notes: qualification_events.notes, reviewer_id: qualification_events.reviewer_id, created_at: qualification_events.created_at })
      .from(qualification_events)
      .where(eq(qualification_events.qualification_id, id))
      .orderBy(desc(qualification_events.created_at)),
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, q.organization_id)),
    db.select({ id: launches.id, status: launches.status }).from(launches).where(eq(launches.app_version_id, q.app_version_id)),
  ]);
  const version = versionRows[0] ? { ...versionRows[0].version, apps: versionRows[0].app } : null;
  const reviewerIds = [...new Set(events.map((e) => e.reviewer_id))];
  const reviewers = reviewerIds.length
    ? await db.select({ id: profiles.id, full_name: profiles.full_name, email: profiles.email }).from(profiles).where(inArray(profiles.id, reviewerIds))
    : [];
  return { q, version, intake: intakeRows[0] ?? null, events, orgName: orgRows[0]?.name ?? "", launches: versionLaunches, reviewers };
}

export async function reviewArea(id: string, area: QualificationArea, status: AreaStatus, notes: string | null) {
  const { db, user } = await requireOperator();
  try {
    await db.execute(sql`select public.qualification_review_area(${id}::uuid, ${area}, ${status}, ${notes}, ${user.id}::uuid)`);
  } catch (e) {
    throw fromDbError(dbErrorMessage(e));
  }
}

/**
 * The operator's final call on one version. The database checks the areas and records the
 * decision; then every launch waiting on this version moves to the matching status.
 */
export async function decideQualification(id: string, decision: Decision, notes: string | null) {
  const { db, user } = await requireOperator();
  let row: { app_version_id: string };
  try {
    [row] = await queryRows<{ app_version_id: string }>(db, sql`select app_version_id from public.qualification_decide(${id}::uuid, ${decision}, ${notes}, ${user.id}::uuid)`);
  } catch (e) {
    throw fromDbError(dbErrorMessage(e));
  }

  const waiting = await db
    .select({ id: launches.id })
    .from(launches)
    .where(and(eq(launches.app_version_id, row.app_version_id), eq(launches.status, "QUALIFICATION_REVIEW")));
  const reason = decision === "qualified" ? "Qualified by operator" : notes ?? undefined;
  for (const l of waiting) {
    await applyTransition(db, { launchId: l.id, to: DECISION_TO_STATUS[decision], actorKind: "operator", actorId: user.id, reason });
  }
  if (decision === "changes_required") {
    // Reopen the founder's intake on the same version so they can fix it and resubmit.
    await db.update(app_intakes).set({ status: "in_progress", submitted_at: null }).where(eq(app_intakes.app_version_id, row.app_version_id));
  }
}
