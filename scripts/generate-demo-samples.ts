/**
 * Generates the landing-page Demo samples by running fictional product briefs through the same
 * OpenAI preparation pipeline launches use (analyze, then strategy, then questions and run-of-show).
 * Output is saved to content/demo-samples.json and replayed on the page, so visitors never
 * trigger paid AI calls. Re-run after prompt changes:
 *   OPENAI_API_KEY=... npx tsx --conditions=react-server scripts/generate-demo-samples.ts
 */
import { writeFileSync } from "node:fs";
import { createOpenAIService } from "@/integrations/ai/openai";
import { SHOW_MINUTES } from "@/integrations/ai/prompts";
import type { LaunchContext, ProductAnalysisInput } from "@/integrations/ai/types";

const briefs: Array<{ id: string; launchType: "founder_demo" | "cohosted_launch"; goal: string; input: ProductAnalysisInput }> = [
  {
    id: "shiftswap",
    launchType: "founder_demo",
    goal: "Free trial signups from restaurant owners",
    input: {
      appName: "ShiftSwap",
      websiteUrl: null,
      founderDescription: "A mobile app where hourly restaurant staff trade shifts with each other, and the manager approves swaps with one tap. It checks overtime and certifications before a swap is allowed.",
      targetCustomer: "Owners and general managers of independent restaurants with 15 to 60 hourly staff",
      problemSolved: "Managers spend hours every week on group texts and last-minute call-outs, and shifts still go uncovered.",
      desiredOutcome: "Every shift covered without the manager chasing people",
      pricingSummary: "$4 per staff member per month, 14-day free trial",
      primaryCta: "Start a free 14-day trial",
      competitors: "Group texts, 7shifts, When I Work",
    },
  },
  {
    id: "invoicepilot",
    launchType: "cohosted_launch",
    goal: "Paid signups from freelancers",
    input: {
      appName: "InvoicePilot",
      websiteUrl: null,
      founderDescription: "A web app for freelancers that reads a signed proposal, creates the invoices on the agreed schedule, and sends polite reminders until the client pays. It connects to Stripe and QuickBooks.",
      targetCustomer: "Freelance designers, developers and consultants billing $5k to $30k per month",
      problemSolved: "Freelancers lose money and time to late payments and awkward follow-up emails.",
      desiredOutcome: "Get paid on time without chasing clients",
      pricingSummary: "$19 per month, cancel anytime",
      primaryCta: "Create your first invoice schedule",
      competitors: "FreshBooks, Bonsai, spreadsheets and manual reminders",
    },
  },
  {
    id: "clinicqueue",
    launchType: "founder_demo",
    goal: "Booked demos with clinic managers",
    input: {
      appName: "ClinicQueue",
      websiteUrl: null,
      founderDescription: "A text-message check-in and waitlist for walk-in clinics. Patients join the line from their phone, get a text when it's almost their turn, and can wait in their car instead of the lobby.",
      targetCustomer: "Practice managers at urgent care and walk-in clinics",
      problemSolved: "Crowded waiting rooms, patients leaving before being seen, and front-desk staff answering 'how much longer?' all day.",
      desiredOutcome: "Fewer walkouts and a calmer front desk",
      pricingSummary: "$199 per location per month",
      primaryCta: "Book a 20-minute demo",
      competitors: "Paper sign-in sheets, Solv, Clockwise.MD",
    },
  },
];

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const ai = createOpenAIService({ apiKey, model });
  const samples = [];
  for (const b of briefs) {
    const started = Date.now();
    const context: LaunchContext = { launchId: `demo-${b.id}`, appName: b.input.appName, launchType: b.launchType, primaryGoal: b.goal, founderNotes: null };
    const analysis = await ai.analyzeProduct(b.input);
    const strategy = await ai.generateLaunchStrategy({ context, analysis: analysis.output });
    const duration = SHOW_MINUTES[b.launchType];
    const [questions, runbook] = await Promise.all([
      ai.generateCustomerQuestions({ context, analysis: analysis.output }),
      ai.generateRunbook({ context, strategy: strategy.output, durationMinutes: duration }),
    ]);
    samples.push({
      id: b.id,
      launchType: b.launchType,
      goal: b.goal,
      brief: b.input,
      analysis: analysis.output,
      strategy: strategy.output,
      questions: questions.output.questions,
      runbook: runbook.output,
      provenance: {
        model: runbook.meta.model,
        promptVersions: [analysis.meta.promptVersion, strategy.meta.promptVersion, questions.meta.promptVersion, runbook.meta.promptVersion],
        mocked: [analysis, strategy, questions, runbook].some((r) => r.meta.mocked),
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      },
    });
    console.log(`${b.input.appName}: done in ${Date.now() - started}ms`);
  }
  if (samples.some((s) => s.provenance.mocked)) throw new Error("A sample came from the mock; refusing to save.");
  writeFileSync("content/demo-samples.json", JSON.stringify({ samples }, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
