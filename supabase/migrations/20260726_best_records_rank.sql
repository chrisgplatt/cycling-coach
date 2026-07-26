-- Adds a rank dimension to best_records so each (period, category, sub_key,
-- is_indoor) slot can hold up to 3 rows — the top-3 podium (gold/silver/
-- bronze) — instead of only the single champion. Existing rows default to
-- rank 1 as a placeholder only: they ARE the current champion, so rank 1 is
-- correct for them; re-running "Resync bests" (Settings) after this migration
-- backfills 2nd/3rd place for the rider's full history. Run in the Supabase
-- SQL editor before deploying the matching app version.

alter table best_records add column if not exists rank integer not null default 1;

-- Drop whatever the OLD 5-column unique constraint is actually named, found
-- dynamically by its column set rather than guessed — Postgres auto-names
-- unnamed constraints, and this repo has no way to confirm the real
-- production name ahead of time (no linked Supabase CLI).
do $$
declare
  old_constraint_name text;
begin
  select c.conname into old_constraint_name
  from pg_constraint c
  where c.conrelid = 'best_records'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname)
      from unnest(c.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    ) = array['category', 'is_indoor', 'period', 'sub_key', 'user_id']
  limit 1;

  if old_constraint_name is not null then
    execute format('alter table best_records drop constraint %I', old_constraint_name);
  end if;
end $$;

-- Add the new 6-column unique constraint (idempotent — only adds if missing).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'best_records'::regclass
      and conname = 'best_records_user_id_period_category_sub_key_is_indoor_rank_key'
  ) then
    alter table best_records add constraint best_records_user_id_period_category_sub_key_is_indoor_rank_key
      unique (user_id, period, category, sub_key, is_indoor, rank);
  end if;
end $$;

notify pgrst, 'reload schema';
