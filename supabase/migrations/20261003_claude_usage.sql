-- Per-call Claude token usage, for the admin usage dashboard (/settings/usage).
-- Run in Supabase SQL editor (Project → SQL Editor → New query). Idempotent.

create table if not exists claude_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  label text not null,
  model text,
  trigger text,
  route text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  stop_reason text,
  metadata jsonb
);

create index if not exists claude_usage_created_at_idx on claude_usage (created_at desc);
create index if not exists claude_usage_user_created_idx on claude_usage (user_id, created_at desc);

-- No policies: only the service role (which bypasses RLS) reads or writes this table.
alter table claude_usage enable row level security;

notify pgrst, 'reload schema';
