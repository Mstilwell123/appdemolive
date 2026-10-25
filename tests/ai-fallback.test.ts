import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { AppError } from "@/domain/errors";
import { mockAIService } from "@/integrations/ai/mock";
import type { AIService } from "@/integrations/ai/types";
import { checkOpenAIKey, getProviders, resetOpenAIStateForTests, withSampleFallback } from "@/services/providers";

const input = { appName: "Demo", websiteUrl: null, founderDescription: null, targetCustomer: null, problemSolved: null };

describe("AI sample fallback", () => {
  const saved = process.env.OPENAI_API_KEY;
  afterEach(() => { process.env.OPENAI_API_KEY = saved; resetOpenAIStateForTests(); });

  it("uses labeled samples when no key is set", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await getProviders().ai.analyzeProduct(input);
    expect(r.meta.mocked).toBe(true);
    expect(r.output.summary).toContain("[MOCK]");
  });
  it("falls back to labeled samples when OpenAI rejects the key", async () => {
    let rejected = false;
    const real = { ...mockAIService, provider: { mocked: false, model: "x" },
      analyzeProduct: async () => { throw new AppError("PROVIDER_AUTH_REQUIRED", "The OpenAI key was rejected"); } } as AIService;
    const ai = withSampleFallback(real, () => { rejected = true; });
    const r = await ai.analyzeProduct(input);
    expect(r.meta.mocked).toBe(true);
    expect(rejected).toBe(true);
  });
  it("still surfaces non-auth errors", async () => {
    const real = { ...mockAIService, analyzeProduct: async () => { throw new AppError("PROCESSING_FAILED", "bad"); } } as AIService;
    await expect(withSampleFallback(real, () => {}).analyzeProduct(input)).rejects.toThrow("bad");
  });
  it("reports AI live only when the key check succeeds", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    expect(await checkOpenAIKey(async () => new Response("{}", { status: 200 }))).toBe("openai");
    resetOpenAIStateForTests();
    expect(await checkOpenAIKey(async () => new Response("{}", { status: 401 }))).toBe("mock");
    expect(getProviders().ai.provider.mocked).toBe(true);
    resetOpenAIStateForTests();
    delete process.env.OPENAI_API_KEY;
    expect(await checkOpenAIKey(async () => { throw new Error("should not call"); })).toBe("mock");
  });
});
