-- Nightly conversation digest: one row per user, upserted by the cron.
create table if not exists coach_conversation_memory (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  digest             text not null default '',
  open_threads       jsonb not null default '[]',
  recurring_concerns jsonb not null default '[]',
  commitments        jsonb not null default '[]',
  synthesized_at     timestamptz not null default now()
);

alter table coach_conversation_memory enable row level security;

create policy "own data" on coach_conversation_memory
  using (user_id = auth.uid()) with check (user_id = auth.uid());
