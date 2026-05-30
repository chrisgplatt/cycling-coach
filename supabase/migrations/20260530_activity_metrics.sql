-- Enriched completed-ride detail captured at sync time.
-- Holds NP/power/HR/terrain scalars, power-curve best efforts, and detected intervals.
-- Shape: see ActivityMetrics in types/index.ts. Null until the sync backfill pass fills it.
alter table workouts add column if not exists activity_metrics jsonb;
