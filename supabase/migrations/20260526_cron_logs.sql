-- Cron run logs for diagnosing notification delivery
-- Run in Supabase SQL editor (Project → SQL Editor → New query)

create table if not exists cron_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_at timestamptz not null,
  user_id uuid references auth.users(id) on delete cascade,
  event text not null,
  status text not null default 'ok',
  details jsonb
);

alter table cron_logs enable row level security;

-- Users can read their own log entries; global entries (user_id IS NULL) are readable by all authenticated users
create policy "read own cron logs" on cron_logs
  for select using (user_id = auth.uid() or user_id is null);

-- Only service role can insert (cron uses service role key, bypasses RLS anyway)
