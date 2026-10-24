import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { ai_runs } from "@/db/schema";
import { AppError } from "@/domain/errors";
import type { AIResult } from "@/integrations/ai/types";
import { dbErrorCode, type Db } from "@/lib/db";

export type AITaskType =
  | "analyze_product" | "generate_launch_strategy" | "generate_runbook" | "generate_customer_questions"
  | "analyze_recording" | "generate_clip_candidates" | "analyze_performance" | "propose_experiments";

/** A run older than this that still says "running" was cut off (deploy, timeout) and is closed out. */
const STALE_MS = 5 * 60 * 1000;
const now = () => new Date().toISOString();

/**
 * Records one AI call in ai_runs (§84): a running row before the call, then the output or the
 * error after. For launch-scoped runs the unique index on (launch_id, task_type) where running
 * doubles as a lock, so a second tab or double click can't start the same task twice.
 * Callers must have authorized the organization/launch first.
 */
export async function recordAIRun<T>(
  db: Db,
  run: { organizationId: string; launchId: string | null; taskType: AITaskType; inputReference: Record<string, unknown>; model: string; promptVersion: string; mocked: boolean },
  call: () => Promise<AIResult<T>>,
): Promise<{ runId: string; result: AIResult<T> }> {
  if (run.launchId) {
    await db
      .update(ai_runs)
      .set({ status: "failed", error_code: "PROCESSING_FAILED", error_message: "Timed out", completed_at: now() })
      .where(and(eq(ai_runs.launch_id, run.launchId), eq(ai_runs.task_type, run.taskType), eq(ai_runs.status, "running"), lt(ai_runs.started_at, new Date(Date.now() - STALE_MS).toISOString())));
  }

  let row: { id: string } | undefined;
  try {
    [row] = await db
      .insert(ai_runs)
      .values({
        organization_id: run.organizationId,
        launch_id: run.launchId,
        task_type: run.taskType,
        source: run.mocked ? "mock" : "openai",
        model: run.model,
        prompt_version: run.promptVersion,
        input_reference: run.inputReference,
      })
      .returning({ id: ai_runs.id });
  } catch (e) {
    if (dbErrorCode(e) === "23505") throw new AppError("INVALID_STATE_TRANSITION", "Your plan is already being built");
    throw new AppError("INTERNAL_ERROR", "Could not record the AI run");
  }
  if (!row) throw new AppError("INTERNAL_ERROR", "Could not record the AI run");
  const runId = row.id;

  try {
    const result = await call();
    await db
      .update(ai_runs)
      .set({ status: "succeeded", output: result.output, model: result.meta.model, source: result.meta.mocked ? "mock" : "openai", completed_at: now() })
      .where(eq(ai_runs.id, runId));
    return { runId, result };
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError("PROCESSING_FAILED", "The AI step failed");
    await db
      .update(ai_runs)
      .set({ status: "failed", error_code: err.code, error_message: err.message.slice(0, 2000), completed_at: now() })
      .where(eq(ai_runs.id, runId));
    if (!(e instanceof AppError)) console.error(JSON.stringify({ level: "error", msg: "ai_run_failed", runId, taskType: run.taskType, error: (e as Error).message }));
    throw err;
  }
}
