-- Plan generation jobs migration
-- Run in Supabase SQL editor (Project → SQL Editor → New query)

create table if not exists plan_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('generate', 'review', 'extend')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  progress jsonb not null default '{"total": 0, "completed": 0, "failed_days": []}',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table plan_generation_jobs enable row level security;
create policy "own data" on plan_generation_jobs
  using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
