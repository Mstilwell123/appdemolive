import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/domain/errors";
import { PROMPT_VERSIONS, SHOW_MINUTES } from "@/integrations/ai/prompts";
import type { AIService, LaunchContext, LaunchStrategy, ProductAnalysis, Runbook } from "@/integrations/ai/types";
import { recordAIRun } from "@/services/ai-runs";
import { applyTransition } from "@/services/launches";
import { getProviders } from "@/services/providers";
import { requireService } from "@/services/session";
import { getUserClient } from "@/lib/supabase/server";
import { GOAL_LABELS } from "@/schemas/launch";
import type { LaunchType } from "@/types/launch";

// Show length comes from the launch type (PRD pricing: 15 and 30 minutes).
const DURATION: Record<LaunchType, number> = SHOW_MINUTES;

/** The signed-in caller must belong to the launch's organization (founder) or be platform staff (operator). */
export async function authorizeLaunch(launchId: string) {
  const userClient = await getUserClient();
  if (!userClient) throw new AppError("PROVIDER_UNAVAILABLE", "Supabase is not configured");
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) throw new AppError("UNAUTHORIZED", "Sign in required");
  const service = requireService();
  const { data: launch } = await service
    .from("launches")
    .select("id, organization_id, app_id, app_version_id, status, launch_type")
    .eq("id", launchId)
    .maybeSingle();
  if (!launch) throw new AppError("NOT_FOUND", "Launch not found");
  const [{ data: member }, { data: staff }] = await Promise.all([
    service.from("organization_members").select("id").eq("organization_id", launch.organization_id).eq("user_id", auth.user.id).maybeSingle(),
    service.from("platform_staff").select("role").eq("user_id", auth.user.id).maybeSingle(),
  ]);
  const isStaff = Boolean(staff && ["admin", "operator"].includes(staff.role));
  if (!member && !isStaff) throw new AppError("NOT_FOUND", "Launch not found"); // don't reveal other orgs' launches
  return { service, user: auth.user, launch, actorKind: (member ? "founder" : "operator") as "founder" | "operator" };
}

/**
 * Phase 3 preparation (§11, §42 Phase 3, §59, §80–82). For a paid launch in PREPARATION: make
 * sure there is a product analysis, then generate the launch strategy, likely customer questions
 * and a run-of-show, store them as new draft versions, and move the launch to
 * AWAITING_FOUNDER_APPROVAL. AI proposes; the founder approves before anything is used.
 */
export async function prepareLaunch(launchId: string) {
  const { service, launch } = await authorizeLaunch(launchId);
  return runPreparation(service, getProviders().ai, launch);
}

export async function runPreparation(
  service: SupabaseClient,
  ai: AIService,
  launch: { id: string; organization_id: string; app_id: string; app_version_id: string; status: string; launch_type: string | null },
) {
  if (launch.status === "AWAITING_FOUNDER_APPROVAL") return { status: "ready" as const };
  if (launch.status !== "PREPARATION") throw new AppError("INVALID_STATE_TRANSITION", "The launch plan is prepared after payment");

  // Claim the launch atomically so a second tab or double click can't generate a second plan.
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: claimed } = await service
    .from("launches")
    .update({ preparation_started_at: new Date().toISOString() })
    .eq("id", launch.id)
    .eq("status", "PREPARATION")
    .or(`preparation_started_at.is.null,preparation_started_at.lt.${staleBefore}`)
    .select("id");
  if (!claimed?.length) {
    const { data: now } = await service.from("launches").select("status").eq("id", launch.id).single();
    if (now?.status === "AWAITING_FOUNDER_APPROVAL") return { status: "ready" as const };
    throw new AppError("INVALID_STATE_TRANSITION", "Your plan is already being built");
  }
  try {
    return await generatePlan(service, ai, launch);
  } finally {
    await service.from("launches").update({ preparation_started_at: null }).eq("id", launch.id);
  }
}

async function generatePlan(
  service: SupabaseClient,
  ai: AIService,
  launch: { id: string; organization_id: string; app_id: string; app_version_id: string; status: string; launch_type: string | null },
) {
  const mocked = ai.provider.mocked;
  const org = launch.organization_id;

  const [{ data: app }, { data: intake }, { data: goal }, { data: previous }] = await Promise.all([
    service.from("apps").select("name, website_url").eq("id", launch.app_id).single(),
    service.from("app_intakes").select("*").eq("app_version_id", launch.app_version_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    service.from("launch_goals").select("goal_type, target_value").eq("launch_id", launch.id).eq("is_primary", true).maybeSingle(),
    service.from("launch_strategies").select("version, founder_notes, status").eq("launch_id", launch.id).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!app) throw new AppError("NOT_FOUND", "App not found");

  const context: LaunchContext = {
    launchId: launch.id,
    appName: app.name,
    launchType: (launch.launch_type as LaunchType | null) ?? null,
    primaryGoal: goal ? `${GOAL_LABELS[goal.goal_type as keyof typeof GOAL_LABELS] ?? goal.goal_type}${goal.target_value ? ` (target ${goal.target_value})` : ""}` : null,
    founderNotes: previous?.status === "draft" ? previous.founder_notes ?? null : null,
  };

  // 1. Product analysis: reuse the founder's latest real one; otherwise make one now.
  const { data: understanding } = await service
    .from("product_understandings")
    .select("id, source, output")
    .eq("app_version_id", launch.app_version_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let analysis = understanding?.output as ProductAnalysis | undefined;
  if (!understanding || (understanding.source === "mock" && !mocked)) {
    const input = {
      appName: app.name,
      websiteUrl: app.website_url ?? null,
      founderDescription: intake?.founder_description ?? null,
      targetCustomer: intake?.target_customer ?? null,
      problemSolved: intake?.problem_solved ?? null,
      desiredOutcome: intake?.desired_outcome ?? null,
      pricingSummary: intake?.pricing_summary ?? null,
      primaryCta: intake?.primary_cta ?? null,
      competitors: intake?.competitors ?? null,
    };
    const { runId, result } = await recordAIRun(
      service,
      { organizationId: org, launchId: launch.id, taskType: "analyze_product", inputReference: { appIntakeId: intake?.id ?? null, ...input }, ...meta(ai, "analyze_product") },
      () => ai.analyzeProduct(input),
    );
    analysis = result.output;
    if (intake) {
      await service.from("product_understandings").insert({
        organization_id: org, app_intake_id: intake.id, app_version_id: launch.app_version_id,
        source: result.meta.mocked ? "mock" : "openai", model: result.meta.model, prompt_version: result.meta.promptVersion,
        output: result.output, ai_run_id: runId,
      });
    }
  }

  // 2. Strategy. 3 and 4. Customer questions and run-of-show, in parallel since both only need the strategy inputs.
  const baseRef = { launchId: launch.id, productUnderstandingId: understanding?.id ?? null, founderNotes: context.founderNotes };
  const strategyRun = await recordAIRun(
    service,
    { organizationId: org, launchId: launch.id, taskType: "generate_launch_strategy", inputReference: baseRef, ...meta(ai, "generate_launch_strategy") },
    () => ai.generateLaunchStrategy({ context, analysis: analysis! }),
  );
  const strategy: LaunchStrategy = strategyRun.result.output;
  const durationMinutes = DURATION[(launch.launch_type as LaunchType) ?? "founder_demo"] ?? SHOW_MINUTES.founder_demo;
  const [questionsRun, runbookRun] = await Promise.all([
    recordAIRun(
      service,
      { organizationId: org, launchId: launch.id, taskType: "generate_customer_questions", inputReference: baseRef, ...meta(ai, "generate_customer_questions") },
      () => ai.generateCustomerQuestions({ context, analysis: analysis! }),
    ),
    recordAIRun(
      service,
      { organizationId: org, launchId: launch.id, taskType: "generate_runbook", inputReference: { ...baseRef, strategyRunId: strategyRun.runId, durationMinutes }, ...meta(ai, "generate_runbook") },
      () => ai.generateRunbook({ context, strategy, durationMinutes }),
    ),
  ]);

  // Store as a new draft version, then mark older drafts superseded (§59: never overwritten).
  const version = (previous?.version ?? 0) + 1;
  const { data: savedStrategy, error: sErr } = await service
    .from("launch_strategies")
    .insert({
      organization_id: org, launch_id: launch.id, version, strategy,
      customer_questions: questionsRun.result.output.questions, generated_by_ai_run_id: strategyRun.runId,
    })
    .select("id")
    .single();
  if (sErr || !savedStrategy) throw new AppError("INTERNAL_ERROR", "Could not save the launch strategy");
  await service.from("launch_strategies").update({ status: "superseded" }).eq("launch_id", launch.id).eq("status", "draft").neq("id", savedStrategy.id);

  const rb: Runbook = runbookRun.result.output;
  const { data: savedRunbook, error: rErr } = await service.from("launch_runbooks").insert({
    organization_id: org, launch_id: launch.id, strategy_id: savedStrategy.id, version,
    title: rb.title.slice(0, 200), duration_minutes: Math.min(180, Math.max(5, Math.round(rb.durationMinutes))),
    opening_hook: rb.openingHook, problem_statement: rb.problemStatement, demo_plan: rb.demoPlan,
    use_cases: rb.useCases, questions: rb.questions, cta_script: rb.ctaScript, closing_script: rb.closingScript,
    generated_by_ai_run_id: runbookRun.runId,
  }).select("id").single();
  if (rErr || !savedRunbook) throw new AppError("INTERNAL_ERROR", "Could not save the run-of-show");
  await service.from("launch_runbooks").update({ status: "superseded" }).eq("launch_id", launch.id).eq("status", "draft").neq("id", savedRunbook.id);

  await applyTransition(service, {
    launchId: launch.id, to: "AWAITING_FOUNDER_APPROVAL", actorKind: "system", actorId: null,
    reason: `Launch plan v${version} ready for founder approval`,
  });
  return { status: "ready" as const };
}

/** Model and prompt version recorded before the call; the adapter's reported model replaces it after. */
function meta(ai: AIService, task: keyof typeof PROMPT_VERSIONS) {
  return { model: ai.provider.model, promptVersion: ai.provider.mocked ? "mock-v0" : PROMPT_VERSIONS[task], mocked: ai.provider.mocked };
}

/** Latest plan for the launch page: newest strategy and run-of-show versions plus their AI provenance. */
export async function getLaunchPlan(launchId: string) {
  const supabase = await getUserClient();
  if (!supabase) throw new AppError("PROVIDER_UNAVAILABLE", "Supabase is not configured");
  // RLS: only members of the launch's organization can read these rows.
  const [{ data: strategy }, { data: runbook }, { data: lastRun }] = await Promise.all([
    supabase.from("launch_strategies").select("*").eq("launch_id", launchId).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("launch_runbooks").select("*").eq("launch_id", launchId).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("ai_runs").select("id, task_type, status, error_code, error_message, started_at").eq("launch_id", launchId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  let provenance: { source: string; model: string; prompt_version: string; completed_at: string | null } | null = null;
  if (strategy?.generated_by_ai_run_id) {
    const { data } = await supabase.from("ai_runs").select("source, model, prompt_version, completed_at").eq("id", strategy.generated_by_ai_run_id).maybeSingle();
    provenance = data;
  }
  return { strategy, runbook, provenance, lastRun };
}

/** §18/§44: the founder approves the AI plan. Approved versions are kept; the launch moves to SCHEDULED. */
export async function approveLaunchPlan(launchId: string, expectedVersion: number) {
  const { service, user, launch, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "founder") throw new AppError("FORBIDDEN", "Only the founder can approve the launch plan");
  if (launch.status !== "AWAITING_FOUNDER_APPROVAL") throw new AppError("INVALID_STATE_TRANSITION", "There is no plan waiting for approval");

  const [{ data: strategy }, { data: runbook }] = await Promise.all([
    service.from("launch_strategies").select("id, version").eq("launch_id", launchId).eq("status", "draft").order("version", { ascending: false }).limit(1).maybeSingle(),
    service.from("launch_runbooks").select("id, version").eq("launch_id", launchId).eq("status", "draft").order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!strategy || !runbook) throw new AppError("APPROVAL_REQUIRED", "The plan isn't ready yet");
  // The founder approves what they saw: a newer version appearing meanwhile means they must look again.
  if (strategy.version !== expectedVersion) throw new AppError("INVALID_STATE_TRANSITION", "A newer version of the plan was created. Please review it.");

  const now = new Date().toISOString();
  await Promise.all([
    service.from("launch_strategies").update({ status: "superseded" }).eq("launch_id", launchId).eq("status", "approved"),
    service.from("launch_runbooks").update({ status: "superseded" }).eq("launch_id", launchId).eq("status", "approved"),
  ]);
  const [s, r] = await Promise.all([
    service.from("launch_strategies").update({ status: "approved", approved_by: user.id, approved_at: now }).eq("id", strategy.id).eq("status", "draft"),
    service.from("launch_runbooks").update({ status: "approved", approved_by: user.id, approved_at: now }).eq("id", runbook.id).eq("status", "draft"),
  ]);
  if (s.error || r.error) throw new AppError("INTERNAL_ERROR", "Could not save the approval");
  await service.from("launches").update({ runbook_id: runbook.id }).eq("id", launchId);
  await applyTransition(service, { launchId, to: "SCHEDULED", actorKind: "founder", actorId: user.id, reason: `Founder approved launch plan v${strategy.version}` });
}

/** The founder asks for changes: notes are stored on the current draft and the plan is regenerated. */
export async function requestPlanChanges(launchId: string, notes: string) {
  const { service, user, launch, actorKind } = await authorizeLaunch(launchId);
  if (launch.status !== "AWAITING_FOUNDER_APPROVAL") throw new AppError("INVALID_STATE_TRANSITION", "There is no plan waiting for approval");
  const { data: draft } = await service.from("launch_strategies").select("id").eq("launch_id", launchId).eq("status", "draft").order("version", { ascending: false }).limit(1).maybeSingle();
  if (draft) await service.from("launch_strategies").update({ founder_notes: notes }).eq("id", draft.id);
  await applyTransition(service, { launchId, to: "PREPARATION", actorKind, actorId: user.id, reason: "Founder requested changes to the launch plan" });
}
