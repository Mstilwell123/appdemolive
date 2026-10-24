import { z } from "zod";

/**
 * Zod versions of the §81–82 and §59 structured outputs. The OpenAI adapter sends these as strict
 * JSON schemas and validates every response against them again before anything is stored.
 */
const text = z.string().max(2000);
const list = (max = 12) => z.array(text).max(max);

export const productAnalysisSchema = z.object({
  summary: text,
  targetCustomers: z.array(z.object({ segment: text, problems: list(6), outcomes: list(6) })).max(5),
  primaryProblem: text,
  primaryOutcome: text,
  differentiators: list(),
  objections: list(),
  demoMoments: list(),
  useCases: list(),
  claimsRequiringVerification: list(),
  missingInformation: list(),
});

export const launchStrategySchema = z.object({
  launchObjective: text,
  primaryAudience: text,
  positioning: z.object({ problem: text, promise: text, proof: text }),
  recommendedHook: text,
  demonstrationSequence: z.array(z.object({ step: text, minutes: z.number().min(0).max(60) })).min(1).max(12),
  customerQuestions: list(),
  primaryCta: z.object({ text: text, rationale: text }),
  risks: list(),
});

export const customerQuestionsSchema = z.object({
  questions: z.array(z.object({ question: text, whyItMatters: text })).min(1).max(12),
});

export const runbookSchema = z.object({
  title: z.string().max(200),
  durationMinutes: z.number().int().min(5).max(180),
  openingHook: text,
  problemStatement: text,
  demoPlan: z.array(z.object({ step: text, minutes: z.number().min(0).max(60), script: z.string().max(4000) })).min(1).max(15),
  useCases: list(),
  questions: list(),
  ctaScript: text,
  closingScript: text,
});

/**
 * OpenAI strict mode needs every property listed as required and additionalProperties false on
 * every object. z.toJSONSchema doesn't guarantee both, so this walks the schema and enforces them.
 * Numeric and length bounds are dropped because strict mode rejects some of them; Zod re-checks.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema) as Record<string, unknown>;
  delete raw.$schema;
  return strictify(raw) as Record<string, unknown>;
}

const DROP = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "format", "pattern"]);

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (DROP.has(k)) continue;
    out[k] = strictify(v);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.required = Object.keys(out.properties as object);
    out.additionalProperties = false;
  }
  return out;
}
