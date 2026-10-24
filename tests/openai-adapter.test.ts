import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createOpenAIService, fitRunbookToDuration } from "@/integrations/ai/openai";
import { launchStrategySchema, runbookSchema, toStrictJsonSchema } from "@/integrations/ai/schemas";
import { AppError } from "@/domain/errors";

const strategy = {
  launchObjective: "Get 20 trial signups", primaryAudience: "Agency owners",
  positioning: { problem: "Manual reporting", promise: "Reports in one click", proof: "Live demo" },
  recommendedHook: "Watch a report build itself", demonstrationSequence: [{ step: "Connect data", minutes: 5 }],
  customerQuestions: ["Is my data safe?"], primaryCta: { text: "Start a free trial", rationale: "Matches the goal" }, risks: [],
};
const ok = (content: unknown, model = "gpt-4o-mini-2024-07-18") =>
  new Response(JSON.stringify({ model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content), refusal: null } }] }), { status: 200 });
const fail = (status: number, code = "") => new Response(JSON.stringify({ error: { code, message: "x" } }), { status });
const ctx = { launchId: "l1", appName: "ReportBot", launchType: "founder_demo" as const, primaryGoal: "Trial", founderNotes: null };
const analysis = { summary: "", targetCustomers: [], primaryProblem: "", primaryOutcome: "", differentiators: [], objections: [], demoMoments: [], useCases: [], claimsRequiringVerification: [], missingInformation: [] };

function service(responses: Array<Response | Error>) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const svc = createOpenAIService({ apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
  return { svc, fetchImpl };
}

async function code(p: Promise<unknown>) {
  try { await p; return "no error"; } catch (e) { return e instanceof AppError ? e.code : "not an AppError"; }
}

describe("OpenAI adapter", () => {
  it("sends a strict JSON schema and returns validated output with provenance", async () => {
    const { svc, fetchImpl } = service([ok(strategy)]);
    const r = await svc.generateLaunchStrategy({ context: ctx, analysis });
    expect(r.output.primaryCta.text).toBe("Start a free trial");
    expect(r.meta).toEqual({ model: "gpt-4o-mini-2024-07-18", promptVersion: "launch-strategy-v2", mocked: false });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[1].content).toContain("<founder_input>");
  });

  it("marks every object strict: all keys required, no extra properties", () => {
    const walk = (n: Record<string, unknown>): void => {
      if (n.type === "object") {
        expect(n.additionalProperties).toBe(false);
        expect(n.required).toEqual(Object.keys(n.properties as object));
      }
      for (const v of Object.values(n)) if (v && typeof v === "object") walk(v as Record<string, unknown>);
    };
    walk(toStrictJsonSchema(launchStrategySchema));
    walk(toStrictJsonSchema(runbookSchema));
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const { svc, fetchImpl } = service([fail(429), fail(503), ok(strategy)]);
    await svc.generateLaunchStrategy({ context: ctx, analysis });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retry budget with the last transient error", async () => {
    const { svc, fetchImpl } = service([new Error("ECONNRESET"), fail(500), fail(429)]);
    expect(await code(svc.generateLaunchStrategy({ context: ctx, analysis }))).toBe("RATE_LIMITED");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("never retries a bad key, an empty account or a bad request", async () => {
    for (const [res, expected] of [[fail(401), "PROVIDER_AUTH_REQUIRED"], [fail(429, "insufficient_quota"), "PROVIDER_AUTH_REQUIRED"], [fail(400), "PROCESSING_FAILED"]] as const) {
      const { svc, fetchImpl } = service([res]);
      expect(await code(svc.generateLaunchStrategy({ context: ctx, analysis }))).toBe(expected);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects refusals, truncated answers and output that doesn't match the schema", async () => {
    const refusal = new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: "no" } }] }), { status: 200 });
    const cut = new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{" } }] }), { status: 200 });
    for (const res of [refusal, cut, ok({ launchObjective: "only one field" })]) {
      const { svc } = service([res]);
      expect(await code(svc.generateLaunchStrategy({ context: ctx, analysis }))).toBe("PROCESSING_FAILED");
    }
  });

  it("keeps later-phase methods on the labeled mock", async () => {
    const { svc, fetchImpl } = service([]);
    const r = await svc.analyzePerformance({ launchId: "l1", metrics: {} });
    expect(r.meta.mocked).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(svc.provider).toEqual({ mocked: false, model: "gpt-4o-mini" });
  });
});

describe("fitRunbookToDuration", () => {
  const base = { title: "t", durationMinutes: 30, openingHook: "", problemStatement: "", useCases: [], questions: [], ctaScript: "", closingScript: "" };
  const step = (minutes: number) => ({ step: "s", minutes, script: "x" });
  it("scales steps that overrun the show so they add up exactly", () => {
    const out = fitRunbookToDuration({ ...base, demoPlan: [5, 10, 10, 10, 5, 5, 5].map(step) }, 30);
    expect(out.demoPlan.reduce((n, d) => n + d.minutes, 0)).toBe(30);
    expect(out.demoPlan.every((d) => d.minutes >= 1)).toBe(true);
    expect(out.demoPlan[1].minutes).toBeGreaterThan(out.demoPlan[0].minutes);
  });
  it("leaves a plan that already fits alone and forces the fixed duration", () => {
    const out = fitRunbookToDuration({ ...base, durationMinutes: 20, demoPlan: [10, 20].map(step) }, 30);
    expect(out.demoPlan.map((d) => d.minutes)).toEqual([10, 20]);
    expect(out.durationMinutes).toBe(30);
  });
  it("stretches a short plan", () => {
    const out = fitRunbookToDuration({ ...base, demoPlan: [2, 3].map(step) }, 45);
    expect(out.demoPlan.reduce((n, d) => n + d.minutes, 0)).toBe(45);
  });
});
