# AI launch preparation (Phase 3)

After a founder pays, AppDemo builds a launch plan with OpenAI and the founder approves it before anything is used (PRD §11, §42 Phase 3, §59, §80–84).

## Flow

1. The launch enters `PREPARATION` when the Stripe webhook records payment.
2. The launch page calls `POST /api/v1/launches/:id/prepare` once on load. It:
   - claims the launch (`launches.preparation_started_at`) so only one generation runs at a time; a second call gets `409 "Your plan is already being built"`;
   - reuses the latest real product analysis for the app version, or runs `analyzeProduct` if there is none (or only a placeholder);
   - runs `generateLaunchStrategy`, then `generateCustomerQuestions` and `generateRunbook` in parallel;
   - saves a new draft version in `launch_strategies` and `launch_runbooks` (older drafts are marked `superseded`, never overwritten);
   - moves the launch to `AWAITING_FOUNDER_APPROVAL`.
3. The founder either approves (the draft becomes `approved`, `launches.runbook_id` is set, and the launch moves to `SCHEDULED`) or asks for changes (notes are saved on the draft, the launch returns to `PREPARATION`, and the plan is rebuilt with those notes).

Approval checks the version number the founder saw, so a newer version can't be approved by accident.

## Provenance

Every AI call writes one `ai_runs` row: task, model, prompt version (`integrations/ai/prompts.ts`), the input ids and founder inputs sent, the output, status or error, and timestamps. Strategies and runbooks point back to the run that produced them. The page shows the model, prompt version and time under the plan.

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | No | Without it every AI output is a placeholder marked `[MOCK]` and the page shows an amber "Placeholder plan" notice. |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini`. Must support structured outputs. |

## Failure behavior

- Rate limits, server errors and network failures are retried twice with backoff (1 s, then 3 s).
- A rejected key or an account with no credit fails immediately with `PROVIDER_AUTH_REQUIRED`; bad requests, refusals, cut-off answers and output that doesn't match the schema fail with `PROCESSING_FAILED`. Each failure is recorded on its `ai_runs` row.
- The launch stays in `PREPARATION` and the page shows the error with a "Try again" button.
- Product analysis at intake submission never blocks the submission; preparation retries it.
- A generation cut off mid-way (deploy, timeout) leaves a lock that expires after 5 minutes.

## Not in Phase 3

Recording analysis, clip candidates, performance analysis and experiment proposals stay on the labeled mock until Phases 5, 6 and 9.

## Show length

The show length comes from the launch type, matching the PRD pricing: Founder Demo is 15 minutes and Co-Hosted Launch Show is 30 (`SHOW_MINUTES` in `integrations/ai/prompts.ts`). The model is told the exact length, and run-of-show step minutes are scaled afterwards so they always add up to it (`fitRunbookToDuration`).

## Landing-page demo

The Demo section on the home page replays saved, real output from this pipeline for three fictional sample products (`content/demo-samples.json`), so visitors never trigger paid AI calls. Regenerate it after prompt changes:

```
OPENAI_API_KEY=... npx tsx --conditions=react-server scripts/generate-demo-samples.ts
```
