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
function ai(): AIService {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return mockAIService;
  openai ??= createOpenAIService({ apiKey: key, model: process.env.OPENAI_MODEL || "gpt-4o-mini" });
  return openai;
}
