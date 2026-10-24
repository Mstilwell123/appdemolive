-- Phase 3: one launch-plan generation at a time per launch. Set atomically when preparation
-- starts and cleared when it ends; a value older than 5 minutes is treated as abandoned.
alter table public.launches add column preparation_started_at timestamptz;
