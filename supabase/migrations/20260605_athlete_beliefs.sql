-- Athlete Response Model: structured, accumulating beliefs about how this athlete
-- responds to training. One ACTIVE row per (user_id, key); prior versions are kept
-- inline in `revisions` so there is no second history table.
create table if not exists athlete_beliefs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  key            text not null,                 -- stable id e.g. 'ramp_tolerance'
  label          text not null,                 -- human title
  value_text     text not null,                 -- plain-language claim (shown + prompted)
  value_data     jsonb,                          -- optional structured numbers
  confidence     text not null default 'low' check (confidence in ('low','medium','high')),
  evidence       text not null default '',       -- short "based on…" citation
  source         text not null default 'ai' check (source in ('ai','athlete','computed')),
  status         text not null default 'active'
                   check (status in ('active','confirmed','corrected','dismissed','superseded')),
  first_observed timestamptz not null default now(),
  last_updated   timestamptz not null default now(),
  last_confirmed timestamptz,
  revisions      jsonb not null default '[]',    -- BeliefRevision[]
  contradiction  jsonb,                          -- BeliefContradiction | null
  unique (user_id, key)
);

alter table athlete_beliefs enable row level security;
create policy "own data" on athlete_beliefs
  using (user_id = auth.uid()) with check (user_id = auth.uid());
