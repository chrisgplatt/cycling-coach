create table athlete_dossier (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  synthesized_at  timestamptz not null default now(),
  content         jsonb not null default '{}',
  explicit_notes  jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  unique(user_id)
);

alter table athlete_dossier enable row level security;

create policy "Users can read own dossier" on athlete_dossier
  for select using (auth.uid() = user_id);

create policy "Users can update own dossier" on athlete_dossier
  for update using (auth.uid() = user_id);
