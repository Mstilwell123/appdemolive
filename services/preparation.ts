import "server-only";
import { and, desc, eq, isNull, lt, ne, or } from "drizzle-orm";
import { ai_runs, app_intakes, apps, launch_goals, launch_runbooks, launch_strategies, launches, product_understandings } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { PROMPT_VERSIONS, SHOW_MINUTES } from "@/integrations/ai/prompts";
import type { AIService, LaunchContext, LaunchStrategy, ProductAnalysis, Runbook } from "@/integrations/ai/types";
import type { Db } from "@/lib/db";
import { recordAIRun } from "@/services/ai-runs";
import { applyTransition } from "@/services/launches";
import { getProviders } from "@/services/providers";
import { authorizeLaunch } from "@/services/session";
import { GOAL_LABELS } from "@/schemas/launch";
import type { LaunchType } from "@/types/launch";

export { authorizeLaunch };

// Show length comes from the launch type (PRD pricing: 15 and 30 minutes).
const DURATION: Record<LaunchType, number> = SHOW_MINUTES;

/**
 * Phase 3 preparation (§11, §42 Phase 3, §59, §80–82). For a paid launch in PREPARATION: make
 * sure there is a product analysis, then generate the launch strategy, likely customer questions
 * and a run-of-show, store them as new draft versions, and move the launch to
 * AWAITING_FOUNDER_APPROVAL. AI proposes; the founder approves before anything is used.
 */
export async function prepareLaunch(launchId: string) {
  const { db, launch } = await authorizeLaunch(launchId);
  return runPreparation(db, getProviders().ai, launch);
}

export async function runPreparation(
  db: Db,
  ai: AIService,
  launch: { id: string; organization_id: string; app_id: string; app_version_id: string; status: string; launch_type: string | null },
) {
  if (launch.status === "AWAITING_FOUNDER_APPROVAL") return { status: "ready" as const };
  if (launch.status !== "PREPARATION") throw new AppError("INVALID_STATE_TRANSITION", "The launch plan is prepared after payment");

  // Claim the launch atomically so a second tab or double click can't generate a second plan.
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const claimed = await db
    .update(launches)
    .set({ preparation_started_at: new Date().toISOString() })
    .where(and(eq(launches.id, launch.id), eq(launches.status, "PREPARATION"), or(isNull(launches.preparation_started_at), lt(launches.preparation_started_at, staleBefore))))
    .returning({ id: launches.id });
  if (!claimed.length) {
    const [now] = await db.select({ status: launches.status }).from(launches).where(eq(launches.id, launch.id));
    if (now?.status === "AWAITING_FOUNDER_APPROVAL") return { status: "ready" as const };
    throw new AppError("INVALID_STATE_TRANSITION", "Your plan is already being built");
  }
  try {
    return await generatePlan(db, ai, launch);
  } finally {
    await db.update(launches).set({ preparation_started_at: null }).where(eq(launches.id, launch.id));
  }
}

async function generatePlan(
  db: Db,
  ai: AIService,
  launch: { id: string; organization_id: string; app_id: string; app_version_id: string; status: string; launch_type: string | null },
) {
  const mocked = ai.provider.mocked;
  const org = launch.organization_id;

  const [[app], [intake], [goal], [previous]] = await Promise.all([
    db.select({ name: apps.name, website_url: apps.website_url }).from(apps).where(eq(apps.id, launch.app_id)),
    db.select().from(app_intakes).where(eq(app_intakes.app_version_id, launch.app_version_id)).orderBy(desc(app_intakes.created_at)).limit(1),
    db.select({ goal_type: launch_goals.goal_type, target_value: launch_goals.target_value }).from(launch_goals).where(and(eq(launch_goals.launch_id, launch.id), eq(launch_goals.is_primary, true))),
    db
      .select({ version: launch_strategies.version, founder_notes: launch_strategies.founder_notes, status: launch_strategies.status })
      .from(launch_strategies)
      .where(eq(launch_strategies.launch_id, launch.id))
      .orderBy(desc(launch_strategies.version))
      .limit(1),
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
  const [understanding] = await db
    .select({ id: product_understandings.id, source: product_understandings.source, output: product_understandings.output })
    .from(product_understandings)
    .where(eq(product_understandings.app_version_id, launch.app_version_id))
    .orderBy(desc(product_understandings.created_at))
    .limit(1);
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
      db,
      { organizationId: org, launchId: launch.id, taskType: "analyze_product", inputReference: { appIntakeId: intake?.id ?? null, ...input }, ...meta(ai, "analyze_product") },
      () => ai.analyzeProduct(input),
    );
    analysis = result.output;
    if (intake) {
      await db.insert(product_understandings).values({
        organization_id: org, app_intake_id: intake.id, app_version_id: launch.app_version_id,
        source: result.meta.mocked ? "mock" : "openai", model: result.meta.model, prompt_version: result.meta.promptVersion,
        output: result.output, ai_run_id: runId,
      });
    }
  }

  // 2. Strategy. 3 and 4. Customer questions and run-of-show, in parallel since both only need the strategy inputs.
  const baseRef = { launchId: launch.id, productUnderstandingId: understanding?.id ?? null, founderNotes: context.founderNotes };
  const strategyRun = await recordAIRun(
    db,
    { organizationId: org, launchId: launch.id, taskType: "generate_launch_strategy", inputReference: baseRef, ...meta(ai, "generate_launch_strategy") },
    () => ai.generateLaunchStrategy({ context, analysis: analysis! }),
  );
  const strategy: LaunchStrategy = strategyRun.result.output;
  const durationMinutes = DURATION[(launch.launch_type as LaunchType) ?? "founder_demo"] ?? SHOW_MINUTES.founder_demo;
  const [questionsRun, runbookRun] = await Promise.all([
    recordAIRun(
      db,
      { organizationId: org, launchId: launch.id, taskType: "generate_customer_questions", inputReference: baseRef, ...meta(ai, "generate_customer_questions") },
      () => ai.generateCustomerQuestions({ context, analysis: analysis! }),
    ),
    recordAIRun(
      db,
      { organizationId: org, launchId: launch.id, taskType: "generate_runbook", inputReference: { ...baseRef, strategyRunId: strategyRun.runId, durationMinutes }, ...meta(ai, "generate_runbook") },
      () => ai.generateRunbook({ context, strategy, durationMinutes }),
    ),
  ]);

  // Store as a new draft version, then mark older drafts superseded (§59: never overwritten).
  const version = (previous?.version ?? 0) + 1;
  const [savedStrategy] = await db
    .insert(launch_strategies)
    .values({
      organization_id: org, launch_id: launch.id, version, strategy,
      customer_questions: questionsRun.result.output.questions, generated_by_ai_run_id: strategyRun.runId,
    })
    .returning({ id: launch_strategies.id })
    .catch(() => []);
  if (!savedStrategy) throw new AppError("INTERNAL_ERROR", "Could not save the launch strategy");
  await db
    .update(launch_strategies)
    .set({ status: "superseded" })
    .where(and(eq(launch_strategies.launch_id, launch.id), eq(launch_strategies.status, "draft"), ne(launch_strategies.id, savedStrategy.id)));

  const rb: Runbook = runbookRun.result.output;
  const [savedRunbook] = await db
    .insert(launch_runbooks)
    .values({
      organization_id: org, launch_id: launch.id, strategy_id: savedStrategy.id, version,
      title: rb.title.slice(0, 200), duration_minutes: Math.min(180, Math.max(5, Math.round(rb.durationMinutes))),
      opening_hook: rb.openingHook, problem_statement: rb.problemStatement, demo_plan: rb.demoPlan,
      use_cases: rb.useCases, questions: rb.questions, cta_script: rb.ctaScript, closing_script: rb.closingScript,
      generated_by_ai_run_id: runbookRun.runId,
    })
    .returning({ id: launch_runbooks.id })
    .catch(() => []);
  if (!savedRunbook) throw new AppError("INTERNAL_ERROR", "Could not save the run-of-show");
  await db
    .update(launch_runbooks)
    .set({ status: "superseded" })
    .where(and(eq(launch_runbooks.launch_id, launch.id), eq(launch_runbooks.status, "draft"), ne(launch_runbooks.id, savedRunbook.id)));

  await applyTransition(db, {
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
  const { db } = await authorizeLaunch(launchId);
  const [[strategy], [runbook], [lastRun]] = await Promise.all([
    db.select().from(launch_strategies).where(and(eq(launch_strategies.launch_id, launchId), ne(launch_strategies.status, "superseded"))).orderBy(desc(launch_strategies.version)).limit(1),
    db.select().from(launch_runbooks).where(and(eq(launch_runbooks.launch_id, launchId), ne(launch_runbooks.status, "superseded"))).orderBy(desc(launch_runbooks.version)).limit(1),
    db
      .select({ id: ai_runs.id, task_type: ai_runs.task_type, status: ai_runs.status, error_code: ai_runs.error_code, error_message: ai_runs.error_message, started_at: ai_runs.started_at })
      .from(ai_runs)
      .where(eq(ai_runs.launch_id, launchId))
      .orderBy(desc(ai_runs.started_at))
      .limit(1),
  ]);
  let provenance: { source: string; model: string; prompt_version: string; completed_at: string | null } | null = null;
  if (strategy?.generated_by_ai_run_id) {
    const [run] = await db
      .select({ source: ai_runs.source, model: ai_runs.model, prompt_version: ai_runs.prompt_version, completed_at: ai_runs.completed_at })
      .from(ai_runs)
      .where(eq(ai_runs.id, strategy.generated_by_ai_run_id));
    provenance = run ?? null;
  }
  return { strategy: strategy ?? null, runbook: runbook ?? null, provenance, lastRun: lastRun ?? null };
}

/** §18/§44: the founder approves the AI plan. Approved versions are kept; the launch moves to SCHEDULED. */
export async function approveLaunchPlan(launchId: string, expectedVersion: number) {
  const { db, user, launch, actorKind } = await authorizeLaunch(launchId);
  if (actorKind !== "founder") throw new AppError("FORBIDDEN", "Only the founder can approve the launch plan");
  if (launch.status !== "AWAITING_FOUNDER_APPROVAL") throw new AppError("INVALID_STATE_TRANSITION", "There is no plan waiting for approval");

  const [[strategy], [runbook]] = await Promise.all([
    db.select({ id: launch_strategies.id, version: launch_strategies.version }).from(launch_strategies).where(and(eq(launch_strategies.launch_id, launchId), eq(launch_strategies.status, "draft"))).orderBy(desc(launch_strategies.version)).limit(1),
    db.select({ id: launch_runbooks.id, version: launch_runbooks.version }).from(launch_runbooks).where(and(eq(launch_runbooks.launch_id, launchId), eq(launch_runbooks.status, "draft"))).orderBy(desc(launch_runbooks.version)).limit(1),
  ]);
  if (!strategy || !runbook) throw new AppError("APPROVAL_REQUIRED", "The plan isn't ready yet");
  // The founder approves what they saw: a newer version appearing meanwhile means they must look again.
  if (strategy.version !== expectedVersion) throw new AppError("INVALID_STATE_TRANSITION", "A newer version of the plan was created. Please review it.");

  const now = new Date().toISOString();
  try {
    await db.transaction(async (tx) => {
      await tx.update(launch_strategies).set({ status: "superseded" }).where(and(eq(launch_strategies.launch_id, launchId), eq(launch_strategies.status, "approved")));
      await tx.update(launch_runbooks).set({ status: "superseded" }).where(and(eq(launch_runbooks.launch_id, launchId), eq(launch_runbooks.status, "approved")));
      await tx.update(launch_strategies).set({ status: "approved", approved_by: user.id, approved_at: now }).where(and(eq(launch_strategies.id, strategy.id), eq(launch_strategies.status, "draft")));
      await tx.update(launch_runbooks).set({ status: "approved", approved_by: user.id, approved_at: now }).where(and(eq(launch_runbooks.id, runbook.id), eq(launch_runbooks.status, "draft")));
      await tx.update(launches).set({ runbook_id: runbook.id }).where(eq(launches.id, launchId));
    });
  } catch {
    throw new AppError("INTERNAL_ERROR", "Could not save the approval");
  }
  await applyTransition(db, { launchId, to: "SCHEDULED", actorKind: "founder", actorId: user.id, reason: `Founder approved launch plan v${strategy.version}` });
}

/** The founder asks for changes: notes are stored on the current draft and the plan is regenerated. */
export async function requestPlanChanges(launchId: string, notes: string) {
  const { db, user, launch, actorKind } = await authorizeLaunch(launchId);
  if (launch.status !== "AWAITING_FOUNDER_APPROVAL") throw new AppError("INVALID_STATE_TRANSITION", "There is no plan waiting for approval");
  const [draft] = await db
    .select({ id: launch_strategies.id })
    .from(launch_strategies)
    .where(and(eq(launch_strategies.launch_id, launchId), eq(launch_strategies.status, "draft")))
    .orderBy(desc(launch_strategies.version))
    .limit(1);
  if (draft) await db.update(launch_strategies).set({ founder_notes: notes }).where(eq(launch_strategies.id, draft.id));
  await applyTransition(db, { launchId, to: "PREPARATION", actorKind, actorId: user.id, reason: "Founder requested changes to the launch plan" });
}
