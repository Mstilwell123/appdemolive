import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { app_intakes, app_versions, apps, launches, product_understandings, qualifications } from "@/db/schema";
import { AppError, fromDbError } from "@/domain/errors";
import { missingIntakeFields, slugify, type IntakeDraft, type NewAppInput } from "@/schemas/app";
import { getProviders } from "@/services/providers";
import { applyTransitions } from "@/services/launches";
import { recordAIRun } from "@/services/ai-runs";
import { PROMPT_VERSIONS } from "@/integrations/ai/prompts";
import { dbErrorCode, dbErrorMessage, queryRows, withActor } from "@/lib/db";
import { requireFounder } from "@/services/session";
import type { LaunchStatus } from "@/types/launch";

export interface VersionUrls {
  productUrl: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  pricingUrl: string | null;
}

/** §8 step 1: create the app, version 1 and an in-progress intake in one transaction. */
export async function createApp(input: NewAppInput): Promise<string> {
  const { db, user, orgId } = await requireFounder();
  const base = slugify(input.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 54)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      return await withActor(db, user.id, async (tx) => {
        const [row] = await queryRows<{ id: string }>(
          tx,
          sql`select public.create_app_with_intake(${orgId}::uuid, ${input.name}, ${slug}, ${input.websiteUrl}, ${input.description}, ${input.category}, ${input.businessType}, ${input.founderName}, ${input.companyName}) as id`,
        );
        return row.id;
      });
    } catch (e) {
      if (dbErrorCode(e) !== "23505") throw new AppError("INTERNAL_ERROR", "Could not create the app");
    }
  }
  throw new AppError("INTERNAL_ERROR", "Could not create a unique address for this app");
}

export async function listApps() {
  const { db, orgId } = await requireFounder();
  const rows = await db
    .select({ id: apps.id, name: apps.name, website_url: apps.website_url, category: apps.category, status: apps.status, created_at: apps.created_at })
    .from(apps)
    .where(eq(apps.organization_id, orgId))
    .orderBy(desc(apps.created_at));
  if (!rows.length) return [];
  const versions = await db
    .select({ id: app_versions.id, app_id: app_versions.app_id, version_label: app_versions.version_label, version_number: app_versions.version_number })
    .from(app_versions)
    .where(and(eq(app_versions.organization_id, orgId), inArray(app_versions.app_id, rows.map((r) => r.id))));
  return rows.map((r) => ({
    ...r,
    app_versions: versions.filter((v) => v.app_id === r.id).map(({ id, version_label, version_number }) => ({ id, version_label, version_number })),
  }));
}

/** Everything the app page and intake page need, limited to the founder's organization. */
export async function getAppDetail(appId: string) {
  const { db, orgId } = await requireFounder();
  const [app] = await db
    .select({
      id: apps.id, organization_id: apps.organization_id, name: apps.name, website_url: apps.website_url, description: apps.description,
      category: apps.category, business_type: apps.business_type, status: apps.status, created_at: apps.created_at,
    })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.organization_id, orgId)));
  if (!app) throw new AppError("NOT_FOUND", "App not found");

  const versions = await db
    .select({
      id: app_versions.id, version_label: app_versions.version_label, version_number: app_versions.version_number, product_url: app_versions.product_url,
      privacy_url: app_versions.privacy_url, terms_url: app_versions.terms_url, pricing_url: app_versions.pricing_url,
      snapshot_json: app_versions.snapshot_json, created_at: app_versions.created_at,
    })
    .from(app_versions)
    .where(and(eq(app_versions.app_id, appId), eq(app_versions.organization_id, orgId)))
    .orderBy(desc(app_versions.version_number));
  const latest = versions[0] ?? null;
  const versionIds = versions.map((v) => v.id);

  const [intakeRows, quals, appLaunches] = await Promise.all([
    latest
      ? db.select().from(app_intakes).where(and(eq(app_intakes.app_version_id, latest.id), eq(app_intakes.organization_id, orgId))).orderBy(desc(app_intakes.created_at)).limit(1)
      : Promise.resolve([]),
    versionIds.length
      ? db
          .select({ id: qualifications.id, app_version_id: qualifications.app_version_id, status: qualifications.status, review_notes: qualifications.review_notes, reviewed_at: qualifications.reviewed_at, created_at: qualifications.created_at })
          .from(qualifications)
          .where(and(inArray(qualifications.app_version_id, versionIds), eq(qualifications.organization_id, orgId)))
          .orderBy(desc(qualifications.created_at))
      : Promise.resolve([]),
    db
      .select({ id: launches.id, status: launches.status, launch_type: launches.launch_type, app_version_id: launches.app_version_id, created_at: launches.created_at })
      .from(launches)
      .where(and(eq(launches.app_id, appId), eq(launches.organization_id, orgId)))
      .orderBy(desc(launches.created_at)),
  ]);
  const intake = intakeRows[0] ?? null;

  const [understanding] = intake
    ? await db
        .select({ id: product_understandings.id, source: product_understandings.source, model: product_understandings.model, output: product_understandings.output, created_at: product_understandings.created_at })
        .from(product_understandings)
        .where(and(eq(product_understandings.app_intake_id, intake.id), eq(product_understandings.organization_id, orgId)))
        .orderBy(desc(product_understandings.created_at))
        .limit(1)
    : [];

  const latestQualification = quals.find((q) => q.app_version_id === latest?.id) ?? null;
  return { app, versions, latest, intake, understanding: understanding ?? null, qualifications: quals, latestQualification, launches: appLaunches };
}

/** Saves intake answers and the version's URLs. Allowed only while the intake is in progress. */
export async function saveIntake(appId: string, draft: IntakeDraft, urls: VersionUrls) {
  const { db, orgId } = await requireFounder();
  const detail = await getAppDetail(appId);
  if (!detail.intake || !detail.latest) throw new AppError("NOT_FOUND", "Intake not found");
  if (detail.intake.status !== "in_progress") throw new AppError("INVALID_STATE_TRANSITION", "This intake was already submitted");

  try {
    await db
      .update(app_intakes)
      .set({
        founder_name: draft.founderName,
        company_name: draft.companyName,
        founder_description: draft.founderDescription,
        target_customer: draft.targetCustomer,
        problem_solved: draft.problemSolved,
        desired_outcome: draft.desiredOutcome,
        desired_action: draft.desiredAction,
      })
      .where(and(eq(app_intakes.id, detail.intake.id), eq(app_intakes.organization_id, orgId), eq(app_intakes.status, "in_progress")));
  } catch {
    throw new AppError("INTERNAL_ERROR", "Could not save your answers");
  }

  try {
    await db
      .update(app_versions)
      .set({ product_url: urls.productUrl, privacy_url: urls.privacyUrl, terms_url: urls.termsUrl, pricing_url: urls.pricingUrl })
      .where(and(eq(app_versions.id, detail.latest.id), eq(app_versions.organization_id, orgId)));
  } catch (e) {
    throw fromDbError(dbErrorMessage(e));
  }
  return detail;
}

/**
 * §8 submit: validates the minimum fields, freezes a snapshot on the version, opens a pending
 * qualification for that version, stores AI product understanding separately (mock for now),
 * and moves the app's open launch into qualification review.
 */
export async function submitIntake(appId: string, draft: IntakeDraft, urls: VersionUrls) {
  const missing = missingIntakeFields(draft);
  if (missing.length) throw new AppError("VALIDATION_FAILED", `Please fill in: ${missing.join(", ")}`);

  const detail = await saveIntake(appId, draft, urls);
  const { db, user } = await requireFounder();
  const intake = detail.intake!;
  const version = detail.latest!;

  const snapshot = {
    capturedAt: new Date().toISOString(),
    app: { name: detail.app.name, websiteUrl: detail.app.website_url, category: detail.app.category, businessType: detail.app.business_type },
    urls,
    intake: draft,
  };
  try {
    await db.update(app_versions).set({ snapshot_json: snapshot }).where(eq(app_versions.id, version.id));
  } catch (e) {
    throw fromDbError(dbErrorMessage(e));
  }

  try {
    await db
      .update(app_intakes)
      .set({ status: "submitted", submitted_at: new Date().toISOString() })
      .where(and(eq(app_intakes.id, intake.id), eq(app_intakes.status, "in_progress"))); // a double submit finds nothing to update
  } catch {
    throw new AppError("INTERNAL_ERROR", "Could not submit the intake");
  }

  // One open qualification per version.
  const [open] = await db
    .select({ id: qualifications.id, launch_id: qualifications.launch_id })
    .from(qualifications)
    .where(and(eq(qualifications.app_version_id, version.id), inArray(qualifications.status, ["pending", "in_review"])));
  let qualification = open;
  if (!qualification) {
    try {
      [qualification] = await db
        .insert(qualifications)
        .values({ organization_id: detail.app.organization_id, app_version_id: version.id, created_by: user.id })
        .returning({ id: qualifications.id, launch_id: qualifications.launch_id });
    } catch {
      throw new AppError("INTERNAL_ERROR", "Could not open the review");
    }
  }

  // AI understanding is reference data in its own table; it never overwrites founder answers.
  // An AI failure is recorded but never blocks the submission; preparation retries the analysis later.
  const ai = getProviders().ai;
  const input = {
    appName: detail.app.name,
    websiteUrl: urls.productUrl ?? detail.app.website_url,
    founderDescription: draft.founderDescription,
    targetCustomer: draft.targetCustomer,
    problemSolved: draft.problemSolved,
  };
  try {
    const { runId, result } = await recordAIRun(
      db,
      {
        organizationId: detail.app.organization_id, launchId: null, taskType: "analyze_product",
        inputReference: { appIntakeId: intake.id, ...input },
        model: ai.provider.model, promptVersion: ai.provider.mocked ? "mock-v0" : PROMPT_VERSIONS.analyze_product, mocked: ai.provider.mocked,
      },
      () => ai.analyzeProduct(input),
    );
    await db.insert(product_understandings).values({
      organization_id: detail.app.organization_id,
      app_intake_id: intake.id,
      app_version_id: version.id,
      source: result.meta.mocked ? "mock" : "openai",
      model: result.meta.model,
      prompt_version: result.meta.promptVersion,
      output: result.output,
      ai_run_id: runId,
    });
  } catch (e) {
    console.error(JSON.stringify({ level: "warn", msg: "intake_analysis_failed", appId, error: (e as Error).message }));
  }

  // Move the app's open launch for this version into review.
  const openLaunch = detail.launches.find(
    (l) => l.app_version_id === version.id && ["DRAFT", "INTAKE_IN_PROGRESS", "CHANGES_REQUIRED"].includes(l.status),
  );
  if (openLaunch) {
    const status = openLaunch.status as LaunchStatus;
    const founder = { actorKind: "founder" as const, actorId: user.id };
    const steps = [
      ...(status === "DRAFT" ? [{ to: "INTAKE_IN_PROGRESS" as const, ...founder }] : []),
      { to: "SUBMITTED" as const, ...founder, reason: "Founder submitted intake" },
      { to: "QUALIFICATION_REVIEW" as const, actorKind: "system" as const, actorId: null, reason: "Queued for operator review" },
    ];
    await applyTransitions(db, openLaunch.id, steps);
    if (!qualification.launch_id) await db.update(qualifications).set({ launch_id: openLaunch.id }).where(eq(qualifications.id, qualification.id));
  }
}

/** §51: start the next version (after a decision) so changes get their own qualification. */
export async function createNextVersion(appId: string) {
  const { db, user, orgId } = await requireFounder();
  const [app] = await db.select({ id: apps.id }).from(apps).where(and(eq(apps.id, appId), eq(apps.organization_id, orgId)));
  if (!app) throw new AppError("NOT_FOUND", "App not found");
  try {
    return await withActor(db, user.id, async (tx) => {
      const [row] = await queryRows<{ id: string }>(tx, sql`select public.create_next_app_version(${appId}::uuid) as id`);
      return row.id;
    });
  } catch (e) {
    throw fromDbError(dbErrorMessage(e));
  }
}
