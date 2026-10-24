import "server-only";
import { AppError, fromDbError } from "@/domain/errors";
import { missingIntakeFields, slugify, type IntakeDraft, type NewAppInput } from "@/schemas/app";
import { getProviders } from "@/services/providers";
import { applyTransitions } from "@/services/launches";
import { recordAIRun } from "@/services/ai-runs";
import { PROMPT_VERSIONS } from "@/integrations/ai/prompts";
import { requireFounder, requireService } from "@/services/session";
import type { LaunchStatus } from "@/types/launch";

export interface VersionUrls {
  productUrl: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  pricingUrl: string | null;
}

/** §8 step 1: create the app, version 1 and an in-progress intake in one transaction. */
export async function createApp(input: NewAppInput): Promise<string> {
  const { supabase, orgId } = await requireFounder();
  const base = slugify(input.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 54)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase.rpc("create_app_with_intake", {
      p_organization_id: orgId,
      p_name: input.name,
      p_slug: slug,
      p_website_url: input.websiteUrl,
      p_description: input.description,
      p_category: input.category,
      p_business_type: input.businessType,
      p_founder_name: input.founderName,
      p_company_name: input.companyName,
    });
    if (!error) return data as string;
    if (!/duplicate key|unique/i.test(error.message)) throw new AppError("INTERNAL_ERROR", "Could not create the app");
  }
  throw new AppError("INTERNAL_ERROR", "Could not create a unique address for this app");
}

export async function listApps() {
  const { supabase, orgId } = await requireFounder();
  const { data, error } = await supabase
    .from("apps")
    .select("id, name, website_url, category, status, created_at, app_versions(id, version_label, version_number)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new AppError("INTERNAL_ERROR", "Could not load apps");
  return data ?? [];
}

/** Everything the app page and intake page need, read under RLS. */
export async function getAppDetail(appId: string) {
  const { supabase } = await requireFounder();
  const { data: app } = await supabase
    .from("apps")
    .select("id, organization_id, name, website_url, description, category, business_type, status, created_at")
    .eq("id", appId)
    .maybeSingle();
  if (!app) throw new AppError("NOT_FOUND", "App not found");

  const { data: versions } = await supabase
    .from("app_versions")
    .select("id, version_label, version_number, product_url, privacy_url, terms_url, pricing_url, snapshot_json, created_at")
    .eq("app_id", appId)
    .order("version_number", { ascending: false });
  const latest = versions?.[0] ?? null;
  const versionIds = (versions ?? []).map((v) => v.id);

  const [{ data: intake }, { data: qualifications }, { data: launches }] = await Promise.all([
    latest
      ? supabase.from("app_intakes").select("*").eq("app_version_id", latest.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    versionIds.length
      ? supabase
          .from("qualifications")
          .select("id, app_version_id, status, review_notes, reviewed_at, created_at")
          .in("app_version_id", versionIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("launches").select("id, status, launch_type, app_version_id, created_at").eq("app_id", appId).order("created_at", { ascending: false }),
  ]);

  const { data: understanding } = intake
    ? await supabase
        .from("product_understandings")
        .select("id, source, model, output, created_at")
        .eq("app_intake_id", intake.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const latestQualification = (qualifications ?? []).find((q) => q.app_version_id === latest?.id) ?? null;
  return { app, versions: versions ?? [], latest, intake, understanding, qualifications: qualifications ?? [], latestQualification, launches: launches ?? [] };
}

/** Saves intake answers and the version's URLs. Allowed only while the intake is in progress. */
export async function saveIntake(appId: string, draft: IntakeDraft, urls: VersionUrls) {
  const { supabase } = await requireFounder();
  const detail = await getAppDetail(appId);
  if (!detail.intake || !detail.latest) throw new AppError("NOT_FOUND", "Intake not found");
  if (detail.intake.status !== "in_progress") throw new AppError("INVALID_STATE_TRANSITION", "This intake was already submitted");

  const { error: intakeError } = await supabase
    .from("app_intakes")
    .update({
      founder_name: draft.founderName,
      company_name: draft.companyName,
      founder_description: draft.founderDescription,
      target_customer: draft.targetCustomer,
      problem_solved: draft.problemSolved,
      desired_outcome: draft.desiredOutcome,
      desired_action: draft.desiredAction,
    })
    .eq("id", detail.intake.id);
  if (intakeError) throw new AppError("INTERNAL_ERROR", "Could not save your answers");

  const { error: versionError } = await supabase
    .from("app_versions")
    .update({ product_url: urls.productUrl, privacy_url: urls.privacyUrl, terms_url: urls.termsUrl, pricing_url: urls.pricingUrl })
    .eq("id", detail.latest.id);
  if (versionError) throw fromDbError(versionError.message);
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
  const { user } = await requireFounder();
  const service = requireService();
  const intake = detail.intake!;
  const version = detail.latest!;

  const snapshot = {
    capturedAt: new Date().toISOString(),
    app: { name: detail.app.name, websiteUrl: detail.app.website_url, category: detail.app.category, businessType: detail.app.business_type },
    urls,
    intake: draft,
  };
  const { error: snapErr } = await service.from("app_versions").update({ snapshot_json: snapshot }).eq("id", version.id);
  if (snapErr) throw fromDbError(snapErr.message);

  const { error: submitErr } = await service
    .from("app_intakes")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", intake.id)
    .eq("status", "in_progress"); // a double submit finds nothing to update
  if (submitErr) throw new AppError("INTERNAL_ERROR", "Could not submit the intake");

  // One open qualification per version.
  const { data: open } = await service
    .from("qualifications")
    .select("id, launch_id")
    .eq("app_version_id", version.id)
    .in("status", ["pending", "in_review"])
    .maybeSingle();
  let qualification = open;
  if (!qualification) {
    const { data, error } = await service
      .from("qualifications")
      .insert({ organization_id: detail.app.organization_id, app_version_id: version.id, created_by: user.id })
      .select("id, launch_id")
      .single();
    if (error) throw new AppError("INTERNAL_ERROR", "Could not open the review");
    qualification = data;
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
      service,
      {
        organizationId: detail.app.organization_id, launchId: null, taskType: "analyze_product",
        inputReference: { appIntakeId: intake.id, ...input },
        model: ai.provider.model, promptVersion: ai.provider.mocked ? "mock-v0" : PROMPT_VERSIONS.analyze_product, mocked: ai.provider.mocked,
      },
      () => ai.analyzeProduct(input),
    );
    await service.from("product_understandings").insert({
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
  const open_launch = detail.launches.find(
    (l) => l.app_version_id === version.id && ["DRAFT", "INTAKE_IN_PROGRESS", "CHANGES_REQUIRED"].includes(l.status),
  );
  if (open_launch) {
    const status = open_launch.status as LaunchStatus;
    const founder = { actorKind: "founder" as const, actorId: user.id };
    const steps = [
      ...(status === "DRAFT" ? [{ to: "INTAKE_IN_PROGRESS" as const, ...founder }] : []),
      { to: "SUBMITTED" as const, ...founder, reason: "Founder submitted intake" },
      { to: "QUALIFICATION_REVIEW" as const, actorKind: "system" as const, actorId: null, reason: "Queued for operator review" },
    ];
    await applyTransitions(service, open_launch.id, steps);
    if (!qualification.launch_id) await service.from("qualifications").update({ launch_id: open_launch.id }).eq("id", qualification.id);
  }
}

/** §51: start the next version (after a decision) so changes get their own qualification. */
export async function createNextVersion(appId: string) {
  const { supabase } = await requireFounder();
  const { data, error } = await supabase.rpc("create_next_app_version", { p_app_id: appId });
  if (error) throw fromDbError(error.message);
  return data as string;
}
