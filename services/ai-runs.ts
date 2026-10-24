import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/domain/errors";
import type { AIResult } from "@/integrations/ai/types";

export type AITaskType =
  | "analyze_product" | "generate_launch_strategy" | "generate_runbook" | "generate_customer_questions"
  | "analyze_recording" | "generate_clip_candidates" | "analyze_performance" | "propose_experiments";

/** A run older than this that still says "running" was cut off (deploy, timeout) and is closed out. */
const STALE_MS = 5 * 60 * 1000;

/**
 * Records one AI call in ai_runs (§84): a running row before the call, then the output or the
 * error after. For launch-scoped runs the unique index on (launch_id, task_type) where running
 * doubles as a lock, so a second tab or double click can't start the same task twice.
 */
export async function recordAIRun<T>(
  service: SupabaseClient,
  run: { organizationId: string; launchId: string | null; taskType: AITaskType; inputReference: Record<string, unknown>; model: string; promptVersion: string; mocked: boolean },
  call: () => Promise<AIResult<T>>,
): Promise<{ runId: string; result: AIResult<T> }> {
  if (run.launchId) {
    await service
      .from("ai_runs")
      .update({ status: "failed", error_code: "PROCESSING_FAILED", error_message: "Timed out", completed_at: new Date().toISOString() })
      .eq("launch_id", run.launchId)
      .eq("task_type", run.taskType)
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - STALE_MS).toISOString());
  }

  const { data: row, error } = await service
    .from("ai_runs")
    .insert({
      organization_id: run.organizationId,
      launch_id: run.launchId,
      task_type: run.taskType,
      source: run.mocked ? "mock" : "openai",
      model: run.model,
      prompt_version: run.promptVersion,
      input_reference: run.inputReference,
    })
    .select("id")
    .single();
  if (error?.code === "23505") throw new AppError("INVALID_STATE_TRANSITION", "Your plan is already being built");
  if (error || !row) throw new AppError("INTERNAL_ERROR", "Could not record the AI run");

  try {
    const result = await call();
    await service
      .from("ai_runs")
      .update({ status: "succeeded", output: result.output, model: result.meta.model, source: result.meta.mocked ? "mock" : "openai", completed_at: new Date().toISOString() })
      .eq("id", row.id);
    return { runId: row.id, result };
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError("PROCESSING_FAILED", "The AI step failed");
    await service
      .from("ai_runs")
      .update({ status: "failed", error_code: err.code, error_message: err.message.slice(0, 2000), completed_at: new Date().toISOString() })
      .eq("id", row.id);
    if (!(e instanceof AppError)) console.error(JSON.stringify({ level: "error", msg: "ai_run_failed", runId: row.id, taskType: run.taskType, error: (e as Error).message }));
    throw err;
  }
}
