import "server-only";
import type { z } from "zod";
import { AppError } from "@/domain/errors";
import { mockAIService } from "./mock";
import {
  customerQuestionsMessages, launchStrategyMessages, productAnalysisMessages, PROMPT_VERSIONS, runbookMessages,
} from "./prompts";
import { customerQuestionsSchema, launchStrategySchema, productAnalysisSchema, runbookSchema, toStrictJsonSchema } from "./schemas";
import type { AIResult, AIService, Runbook } from "./types";

type Message = { role: "system" | "user"; content: string };

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Real AIService for the Phase 3 preparation methods (§80–82, §59). Uses Chat Completions with
 * strict JSON-schema structured outputs, validates the result with Zod, and follows the §90 retry
 * policy: transient and rate-limit errors are retried with backoff; auth, quota and bad-input
 * errors are surfaced immediately. Methods for later phases stay on the labeled mock.
 */
export function createOpenAIService(cfg: OpenAIConfig): AIService {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";
  const maxRetries = cfg.maxRetries ?? 2;

  async function structured<T>(name: string, schema: z.ZodType<T>, messages: Message[], promptVersion: string): Promise<AIResult<T>> {
    const body = JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.4,
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema: toStrictJsonSchema(schema) } },
    });

    let lastError: AppError = new AppError("PROVIDER_UNAVAILABLE", "OpenAI did not respond");
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(1000 * 3 ** (attempt - 1));
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(cfg.timeoutMs ?? 60_000),
        });
      } catch {
        lastError = new AppError("PROVIDER_UNAVAILABLE", "Couldn't reach OpenAI");
        continue; // network or timeout: transient
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        const code = err?.error?.code ?? "";
        if (res.status === 401 || res.status === 403) throw new AppError("PROVIDER_AUTH_REQUIRED", "The OpenAI key was rejected");
        if (res.status === 429 && code === "insufficient_quota") throw new AppError("PROVIDER_AUTH_REQUIRED", "The OpenAI account is out of credit");
        if (res.status === 429) { lastError = new AppError("RATE_LIMITED", "OpenAI is rate limiting requests"); continue; }
        if (res.status >= 500) { lastError = new AppError("PROVIDER_UNAVAILABLE", "OpenAI is having problems"); continue; }
        throw new AppError("PROCESSING_FAILED", `OpenAI rejected the request (${res.status})`);
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
      };
      const choice = data.choices?.[0];
      if (choice?.message?.refusal) throw new AppError("PROCESSING_FAILED", "OpenAI declined to produce this output");
      if (choice?.finish_reason === "length") throw new AppError("PROCESSING_FAILED", "OpenAI's answer was cut off");
      let parsed: unknown;
      try {
        parsed = JSON.parse(choice?.message?.content ?? "");
      } catch {
        throw new AppError("PROCESSING_FAILED", "OpenAI returned something that isn't valid JSON");
      }
      const checked = schema.safeParse(parsed);
      if (!checked.success) throw new AppError("PROCESSING_FAILED", "OpenAI's answer didn't match the expected structure");
      return { output: checked.data, meta: { model: data.model ?? cfg.model, promptVersion, mocked: false } };
    }
    throw lastError;
  }

  return {
    // §42: recording, clips, performance and experiments are built in Phases 5, 6 and 9; they stay on the mock.
    ...mockAIService,
    provider: { mocked: false, model: cfg.model },
    analyzeProduct: (input) =>
      structured("product_analysis", productAnalysisSchema, productAnalysisMessages(input), PROMPT_VERSIONS.analyze_product),
    generateLaunchStrategy: ({ context, analysis }) =>
      structured("launch_strategy", launchStrategySchema, launchStrategyMessages(context, analysis), PROMPT_VERSIONS.generate_launch_strategy),
    generateCustomerQuestions: ({ context, analysis }) =>
      structured("customer_questions", customerQuestionsSchema, customerQuestionsMessages(context, analysis), PROMPT_VERSIONS.generate_customer_questions),
    generateRunbook: async ({ context, strategy, durationMinutes }) => {
      const result = await structured("runbook", runbookSchema, runbookMessages(context, strategy, durationMinutes), PROMPT_VERSIONS.generate_runbook);
      return { ...result, output: fitRunbookToDuration(result.output, durationMinutes) };
    },
  };
}

/**
 * Models often ignore the time budget, so a 30-minute show can come back with 50 minutes of steps.
 * The show length is fixed by the launch type (§59), so step minutes are scaled to add up to it exactly.
 */
export function fitRunbookToDuration(rb: Runbook, durationMinutes: number): Runbook {
  const steps = rb.demoPlan;
  const total = steps.reduce((n, d) => n + Math.max(0, d.minutes), 0);
  if (steps.length === 0 || total === durationMinutes) return { ...rb, durationMinutes };
  const raw = steps.map((d) => (total > 0 ? (Math.max(0, d.minutes) / total) * durationMinutes : durationMinutes / steps.length));
  const minutes = raw.map((m) => Math.max(1, Math.floor(m)));
  // Hand the leftover minutes to the steps with the largest rounding loss, or take extras from the longest steps.
  let diff = durationMinutes - minutes.reduce((a, b) => a + b, 0);
  const byLoss = raw.map((m, i) => ({ i, loss: m - Math.floor(m) })).sort((a, b) => b.loss - a.loss);
  for (let k = 0; diff > 0; k++, diff--) minutes[byLoss[k % byLoss.length].i] += 1;
  while (diff < 0) {
    const i = minutes.indexOf(Math.max(...minutes));
    if (minutes[i] <= 1) break;
    minutes[i] -= 1; diff += 1;
  }
  return { ...rb, durationMinutes, demoPlan: steps.map((d, i) => ({ ...d, minutes: minutes[i] })) };
}
