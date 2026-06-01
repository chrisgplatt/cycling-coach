-- HRV focus-card coaching note cache (one row per user, refreshed ~weekly)
create table if not exists hrv_focus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  focus_lever text not null,
  focus_signature text not null,
  coach_note text not null,
  generated_at timestamptz not null default now(),
  unique (user_id)
);

alter table hrv_focus enable row level security;
create policy "own data" on hrv_focus
  using (user_id = auth.uid()) with check (user_id = auth.uid());
