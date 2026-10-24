import "server-only";
import { AppError, fromDbError } from "@/domain/errors";
import { DECISION_TO_STATUS } from "@/domain/qualification";
import type { AreaStatus, Decision, QualificationArea } from "@/schemas/qualification";
import { applyTransition } from "@/services/launches";
import { requireOperator } from "@/services/session";

/** Operator queue (§9): open reviews, oldest first, with their app and version. */
export async function listQualificationQueue() {
  const { service } = await requireOperator();
  const { data: rows, error } = await service
    .from("qualifications")
    .select("id, status, organization_id, app_version_id, launch_id, created_at, reviewer_id")
    .in("status", ["pending", "in_review"])
    .order("created_at", { ascending: true });
  if (error) throw new AppError("INTERNAL_ERROR", "Could not load the queue");
  if (!rows?.length) return [];
  const [{ data: versions }, { data: orgs }] = await Promise.all([
    service.from("app_versions").select("id, version_label, app_id, apps(name, website_url)").in("id", rows.map((r) => r.app_version_id)),
    service.from("organizations").select("id, name").in("id", rows.map((r) => r.organization_id)),
  ]);
  return rows.map((r) => {
    const v = versions?.find((x) => x.id === r.app_version_id);
    const app = (Array.isArray(v?.apps) ? v?.apps[0] : v?.apps) as { name: string; website_url: string | null } | undefined;
    return { ...r, versionLabel: v?.version_label ?? "?", appName: app?.name ?? "Unknown app", appUrl: app?.website_url ?? null, orgName: orgs?.find((o) => o.id === r.organization_id)?.name ?? "" };
  });
}

export async function getQualificationReview(id: string) {
  const { service } = await requireOperator();
  const { data: q } = await service.from("qualifications").select("*").eq("id", id).maybeSingle();
  if (!q) throw new AppError("NOT_FOUND", "Review not found");
  const [{ data: version }, { data: intake }, { data: events }, { data: org }, { data: launches }] = await Promise.all([
    service.from("app_versions").select("*, apps(id, name, website_url, description, category, business_type)").eq("id", q.app_version_id).single(),
    service.from("app_intakes").select("*").eq("app_version_id", q.app_version_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    service.from("qualification_events").select("id, area, status, notes, reviewer_id, created_at").eq("qualification_id", id).order("created_at", { ascending: false }),
    service.from("organizations").select("name").eq("id", q.organization_id).single(),
    service.from("launches").select("id, status").eq("app_version_id", q.app_version_id),
  ]);
  const reviewerIds = [...new Set((events ?? []).map((e) => e.reviewer_id))];
  const { data: reviewers } = reviewerIds.length
    ? await service.from("profiles").select("id, full_name, email").in("id", reviewerIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  return { q, version, intake, events: events ?? [], orgName: org?.name ?? "", launches: launches ?? [], reviewers: reviewers ?? [] };
}

export async function reviewArea(id: string, area: QualificationArea, status: AreaStatus, notes: string | null) {
  const { service, user } = await requireOperator();
  const { error } = await service.rpc("qualification_review_area", {
    p_qualification_id: id, p_area: area, p_status: status, p_notes: notes, p_reviewer_id: user.id,
  });
  if (error) throw fromDbError(error.message);
}

/**
 * The operator's final call on one version. The database checks the areas and records the
 * decision; then every launch waiting on this version moves to the matching status.
 */
export async function decideQualification(id: string, decision: Decision, notes: string | null) {
  const { service, user } = await requireOperator();
  const { data: q, error } = await service.rpc("qualification_decide", {
    p_qualification_id: id, p_decision: decision, p_notes: notes, p_reviewer_id: user.id,
  });
  if (error) throw fromDbError(error.message);
  const row = (Array.isArray(q) ? q[0] : q) as { app_version_id: string };

  const { data: waiting } = await service
    .from("launches")
    .select("id")
    .eq("app_version_id", row.app_version_id)
    .eq("status", "QUALIFICATION_REVIEW");
  const reason = decision === "qualified" ? "Qualified by operator" : notes ?? undefined;
  for (const l of waiting ?? []) {
    await applyTransition(service, { launchId: l.id, to: DECISION_TO_STATUS[decision], actorKind: "operator", actorId: user.id, reason });
  }
  if (decision === "changes_required") {
    // Reopen the founder's intake on the same version so they can fix it and resubmit.
    await service.from("app_intakes").update({ status: "in_progress", submitted_at: null }).eq("app_version_id", row.app_version_id);
  }
}
