/** AIService contract (PRD §80–83). Phase 3 implements the preparation methods with OpenAI; the rest stay labeled mocks until their phase. */
export interface ProductAnalysisInput {
  appName: string;
  websiteUrl: string | null;
  founderDescription: string | null;
  targetCustomer: string | null;
  problemSolved: string | null;
  desiredOutcome?: string | null;
  pricingSummary?: string | null;
  primaryCta?: string | null;
  competitors?: string | null;
}
export interface ProductAnalysis {
  summary: string;
  targetCustomers: Array<{ segment: string; problems: string[]; outcomes: string[] }>;
  primaryProblem: string;
  primaryOutcome: string;
  differentiators: string[];
  objections: string[];
  demoMoments: string[];
  useCases: string[];
  claimsRequiringVerification: string[];
  missingInformation: string[];
}
export interface LaunchStrategy {
  launchObjective: string;
  primaryAudience: string;
  positioning: { problem: string; promise: string; proof: string };
  recommendedHook: string;
  demonstrationSequence: Array<{ step: string; minutes: number }>;
  customerQuestions: string[];
  primaryCta: { text: string; rationale: string };
  risks: string[];
}
/** §59 run-of-show fields. */
export interface Runbook {
  title: string;
  durationMinutes: number;
  openingHook: string;
  problemStatement: string;
  demoPlan: Array<{ step: string; minutes: number; script: string }>;
  useCases: string[];
  questions: string[];
  ctaScript: string;
  closingScript: string;
}
export interface CustomerQuestion {
  question: string;
  whyItMatters: string;
}
export interface LaunchContext {
  launchId: string;
  appName: string;
  launchType: "founder_demo" | "cohosted_launch" | null;
  primaryGoal: string | null;
  founderNotes: string | null;
}
export interface PerformanceAnalysis {
  factualObservations: Array<{ statement: string; metricIds: string[] }>;
  hypotheses: Array<{ statement: string; evidence: string; uncertainty: string }>;
  recommendedExperiments: Array<{ variable: string; control: string; variant: string; primaryMetric: string; reason: string }>;
  limitations: string[];
}
export interface AIRunMeta {
  model: string;
  promptVersion: string;
  mocked: boolean;
}
export interface AIResult<T> {
  output: T;
  meta: AIRunMeta;
}

export interface AIService {
  /** Which backend this is, recorded on each ai_runs row before the call starts. */
  readonly provider: { mocked: boolean; model: string };
  analyzeProduct(input: ProductAnalysisInput): Promise<AIResult<ProductAnalysis>>;
  generateLaunchStrategy(input: { context: LaunchContext; analysis: ProductAnalysis }): Promise<AIResult<LaunchStrategy>>;
  generateRunbook(input: { context: LaunchContext; strategy: LaunchStrategy; durationMinutes: number }): Promise<AIResult<Runbook>>;
  generateCustomerQuestions(input: { context: LaunchContext; analysis: ProductAnalysis }): Promise<AIResult<{ questions: CustomerQuestion[] }>>;
  analyzeRecording(input: { recordingId: string; transcript: string }): Promise<AIResult<{ moments: Array<{ startMs: number; endMs: number; label: string }> }>>;
  generateClipCandidates(input: { recordingId: string; transcript: string; target: number }): Promise<AIResult<{ clips: Array<{ startMs: number; endMs: number; category: string; hook: string }> }>>;
  analyzePerformance(input: { launchId: string; metrics: Record<string, number> }): Promise<AIResult<PerformanceAnalysis>>;
  proposeExperiments(input: { launchId: string; analysis: PerformanceAnalysis }): Promise<AIResult<{ experiments: PerformanceAnalysis["recommendedExperiments"] }>>;
}
