import { AppError } from "@/domain/errors";
import type { AIService } from "@/integrations/ai/types";
import type { BroadcastProvider } from "@/integrations/broadcast/types";
import type { DistributionProvider } from "@/integrations/distribution/types";
import type { DmProvider } from "@/integrations/dm/types";
import type { BillingService } from "@/integrations/billing/types";
import { mockAIService } from "@/integrations/ai/mock";
import { mockBroadcastProvider } from "@/integrations/broadcast/mock";
import { mockDistributionProvider } from "@/integrations/distribution/mock";
import { mockDmProvider } from "@/integrations/dm/mock";
import { mockBillingService } from "@/integrations/billing/mock";
import { createStripeBillingService } from "@/integrations/billing/stripe";
import { createOpenAIService } from "@/integrations/ai/openai";

/**
 * Single place business code gets providers from. Real adapters are used when their env vars are
 * present; everything else is a labeled mock.
 */
export function getProviders(): {
  ai: AIService;
  broadcast: BroadcastProvider;
  distribution: DistributionProvider;
  dm: DmProvider;
  billing: BillingService;
} {
  return {
    ai: ai(),
    broadcast: mockBroadcastProvider,
    distribution: mockDistributionProvider,
    dm: mockDmProvider,
    billing: billing(),
  };
}

let stripeBilling: BillingService | null = null;
function billing(): BillingService {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return mockBillingService;
  if (key.startsWith("sk_live_") && process.env.ALLOW_LIVE_PAYMENTS !== "true") return mockBillingService; // live money needs an explicit switch
  stripeBilling ??= createStripeBillingService(key, process.env.STRIPE_WEBHOOK_SECRET ?? null);
  return stripeBilling;
}

let openai: AIService | null = null;
let openaiRejected = false;
/** True once OpenAI rejected the configured key (bad key or no credit); AI then runs on labeled samples. */
export function isOpenAIKeyRejected() { return openaiRejected; }
export function resetOpenAIStateForTests() { openai = null; openaiRejected = false; keyCheck = null; }

let keyCheck: Promise<"openai" | "mock"> | null = null;
/**
 * Minimal, free check (GET /v1/models) so AI is reported live only when the key actually works.
 * A 401/403 marks the key rejected and leaves the labeled sample fallback on. Network errors aren't cached.
 */
export function checkOpenAIKey(fetchImpl: typeof fetch = fetch): Promise<"openai" | "mock"> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || openaiRejected) return Promise.resolve("mock");
  keyCheck ??= fetchImpl("https://api.openai.com/v1/models?limit=1", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) })
    .then((r) => {
      if (r.ok) return "openai" as const;
      if (r.status === 401 || r.status === 403) openaiRejected = true;
      else keyCheck = null;
      return "mock" as const;
    })
    .catch(() => { keyCheck = null; return "mock" as const; });
  return keyCheck;
}

function ai(): AIService {
  const key = process.env.OPENAI_API_KEY;
  if (!key || openaiRejected) return mockAIService;
  openai ??= withSampleFallback(createOpenAIService({ apiKey: key, model: process.env.OPENAI_MODEL || "gpt-4o-mini" }));
  return openai;
}

/**
 * Uses OpenAI when the key works. If OpenAI rejects the key (PROVIDER_AUTH_REQUIRED), the call is answered
 * by the labeled [MOCK] sample instead (meta.mocked = true) and later calls skip OpenAI until restart.
 */
export function withSampleFallback(real: AIService, onRejected: () => void = () => { openaiRejected = true; }): AIService {
  const wrapped = { ...real } as Record<string, unknown>;
  for (const [name, fn] of Object.entries(real)) {
    if (typeof fn !== "function") continue;
    const sample = (mockAIService as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    wrapped[name] = async (...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args);
      } catch (e) {
        if (e instanceof AppError && e.code === "PROVIDER_AUTH_REQUIRED" && sample) { onRejected(); return sample(...args); }
        throw e;
      }
    };
  }
  return wrapped as unknown as AIService;
}
