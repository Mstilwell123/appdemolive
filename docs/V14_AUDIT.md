# AppDemo.live — PRD v1.4 audit (R1–R9)

Baseline: Phases 1–3 (commit "Baseline"). Status: **exists / partial / missing / conflicts**.
"After v14-r1" reflects this branch.

| Req | Baseline status | Evidence (files) | After v14-r1 |
|---|---|---|---|
| R1 Landing + six-step example campaign | conflicts | `app/(public)/page.tsx` showed generic marketing; `components/demo-walkthrough.tsx` used 3 fictional samples with no media, results, or tracked link | **exists**: `components/landing-page.tsx`, `components/stage-navigator.tsx`, `components/example-campaign.tsx`, `content/example-campaign.json`, `public/example/*`, `app/r/example/route.ts`, `lib/example-cta.ts` |
| R2 Public fixes (nav overflow, tabs a11y, 404, InvoicePilot trial) | conflicts | `components/site-header.tsx` overflowed at 320px; plan tabs lacked keyboard and ARIA; no `app/not-found.tsx`; `content/demo-samples.json` invented a free trial for InvoicePilot | **exists**: phone menu in header, `lib/tabs.ts` roving tabindex, `app/not-found.tsx`, `components/site-footer.tsx`, trial removed with a `corrections` note |
| R3 Understand / truth sheet | partial | `supabase/migrations/…08_ai_intelligence.sql` (product_understandings, strategies), `services/preparation.ts`, `integrations/ai` (OpenAI adapter). No founder-editable truth sheet or approval | unchanged (next slice) |
| R4 Demonstrate / capture upload | missing | No upload path, storage bucket, or capture status. `domain/launch-stages.ts` has 7 founder stages, not the six | unchanged |
| R5 Create / content pack + versioned approvals | partial | runbooks/strategies tables (`…08`), approval gates in `domain/launch-state-machine.ts`; no clip/post assets or per-version approvals | unchanged |
| R6 Promote / 14-day manual plan | missing | `integrations/broadcast`, `integrations/distribution`, `integrations/dm` are mocks or interfaces only (auto-posting is out of scope) | unchanged |
| R7 Measure / tracked links | partial | `launches.tracked_destination_url` column (`…05`); example redirect now in `lib/example-cta.ts` (logs only, no DB) | example only; persisted clicks are deferred to R7 |
| R8 Improve / one experiment | partial | experiments/hypotheses tables (`…04`); no evidence-linked UI | example only (static) |
| R9 Privacy / RLS | partial | RLS policies (`…06_security_hardening.sql`), `tests/rls.test.ts` (pglite). **No privacy or terms pages** | unchanged; blocker |

## Assumptions (also in `content/example-campaign.json`)
- **A1** The example app is the InvoicePilot sample (fictional).
- **A2** All footage is illustrative, rendered by `scripts/render-example-media.py`, and labeled "Illustrative example" on every frame.
- **A3** Every result is labeled "Example data"; an unavailable source is shown as unavailable, never as 0.
- **A4** The 14-day plan and two revision rounds are product behavior, not package terms.

## Preserved
Launch is the core object; the $499 Founder Demo and $799 Co-Hosted packages (`DEFAULT_LAUNCH_PRICES`); OpenAI behind the adapter; Supabase is the system of record; human approval gates. Example clicks are never conversions.

## Verification (v14-r1)
`tsc --noEmit` passes; `eslint .` has 0 errors; `vitest run` passes 94/94 (13 files, including new `tests/stage-navigator.test.ts` and `tests/example-cta.test.ts`); `next build` succeeds. With `next start`, `/r/example` returns 303 to `/?example_click=1#stage-measure` and `/nope` returns 404.
Playwright check: scrollWidth equals clientWidth on home, pricing, and 404 at 1440, 390, and 320. Arrow/Home/End keys move focus, select the tab, and update the hash, and `#stage-promote` restores the Promote tab.
Screenshots are in `docs/shots/`.
