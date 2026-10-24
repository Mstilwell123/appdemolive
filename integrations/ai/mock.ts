import type { AIService } from "./types";

const meta = { model: "mock", promptVersion: "mock-v0", mocked: true } as const;
const MOCK = "[MOCK] Placeholder. Set OPENAI_API_KEY for real analysis.";

/** Deterministic placeholder. Every output is labeled [MOCK] so it can never pass as real analysis. */
export const mockAIService: AIService = {
  provider: { mocked: true, model: "mock" },
  async analyzeProduct(input) {
    return {
      meta,
      output: {
        summary: `${MOCK} ${input.appName}`,
        targetCustomers: [],
        primaryProblem: MOCK,
        primaryOutcome: MOCK,
        differentiators: [],
        objections: [],
        demoMoments: [],
        useCases: [],
        claimsRequiringVerification: [],
        missingInformation: ["OpenAI is not connected"],
      },
    };
  },
  async generateLaunchStrategy() {
    return {
      meta,
      output: {
        launchObjective: MOCK,
        primaryAudience: MOCK,
        positioning: { problem: MOCK, promise: MOCK, proof: MOCK },
        recommendedHook: MOCK,
        demonstrationSequence: [],
        customerQuestions: [],
        primaryCta: { text: MOCK, rationale: MOCK },
        risks: [],
      },
    };
  },
  async generateRunbook({ durationMinutes }) {
    return {
      meta,
      output: {
        title: MOCK,
        durationMinutes,
        openingHook: MOCK,
        problemStatement: MOCK,
        demoPlan: [{ step: MOCK, minutes: durationMinutes, script: MOCK }],
        useCases: [],
        questions: [],
        ctaScript: MOCK,
        closingScript: MOCK,
      },
    };
  },
  async generateCustomerQuestions() {
    return { meta, output: { questions: [{ question: MOCK, whyItMatters: MOCK }] } };
  },
  async analyzeRecording() {
    return { meta, output: { moments: [] } };
  },
  async generateClipCandidates() {
    return { meta, output: { clips: [] } };
  },
  async analyzePerformance() {
    return { meta, output: { factualObservations: [], hypotheses: [], recommendedExperiments: [], limitations: [MOCK] } };
  },
  async proposeExperiments() {
    return { meta, output: { experiments: [] } };
  },
};
