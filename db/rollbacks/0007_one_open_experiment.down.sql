drop index if exists public.experiment_results_snapshot_variant;
alter table public.experiment_results drop column if exists snapshot_id;
drop index if exists public.experiments_one_open_per_launch;
