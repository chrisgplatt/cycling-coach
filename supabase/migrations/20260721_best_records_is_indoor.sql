-- Adds an is_indoor dimension to best_records so a trainer/virtual ride's
-- climbs/power/speed/max-speed never compete against (or overwrite) a
-- real-world outdoor record. Existing rows default to false as a
-- placeholder only — the rollout's resync step (run after the existing
-- metrics backfill re-enriches every ride with a real is_indoor value)
-- recomputes every row from scratch, so the placeholder never stands as
-- final data. Run in the Supabase SQL editor before deploying the
-- matching app version.

alter table best_records add column if not exists is_indoor boolean not null default false;

-- Drop whatever the OLD 4-column unique constraint is actually named,
-- found dynamically by its column set rather than guessed — Postgres
-- auto-names unnamed constraints, and this repo has no way to confirm the
-- real production name ahead of time (no linked Supabase CLI).
do $$
declare
  old_constraint_name text;
begin
  select c.conname into old_constraint_name
  from pg_constraint c
  where c.conrelid = 'best_records'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname order by a.attname)
      from unnest(c.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    ) = array['category', 'period', 'sub_key', 'user_id']
  limit 1;

  if old_constraint_name is not null then
    execute format('alter table best_records drop constraint %I', old_constraint_name);
  end if;
end $$;

-- Add the new 5-column unique constraint (idempotent — only adds if missing).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'best_records'::regclass
      and conname = 'best_records_user_id_period_category_sub_key_is_indoor_key'
  ) then
    alter table best_records add constraint best_records_user_id_period_category_sub_key_is_indoor_key
      unique (user_id, period, category, sub_key, is_indoor);
  end if;
end $$;

notify pgrst, 'reload schema';
