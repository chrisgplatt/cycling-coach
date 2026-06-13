-- Add baseline FTP to training_plans so we can compute FTP delta since plan start
alter table training_plans
  add column if not exists baseline_ftp integer;

-- One progress brief per user, upserted on each qualifying sync
create table if not exists progress_briefs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users not null unique,
  content      text not null,
  metrics_snapshot jsonb not null,
  generated_at timestamptz not null default now()
);

alter table progress_briefs enable row level security;

create policy "Users can manage their own progress brief"
  on progress_briefs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
