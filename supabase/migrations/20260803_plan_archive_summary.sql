-- supabase/migrations/20260803_plan_archive_summary.sql
alter table training_plans add column if not exists closed_at timestamptz;
alter table training_plans add column if not exists archive_summary jsonb;
