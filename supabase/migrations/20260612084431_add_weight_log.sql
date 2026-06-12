create table if not exists weight_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  date        date not null,
  weight_kg   numeric(5,2) not null,
  created_at  timestamptz default now(),
  unique (user_id, date)
);

alter table weight_log enable row level security;

create policy "Users can manage their own weight log"
  on weight_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
