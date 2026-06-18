create table if not exists daily_wellness (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  energy smallint,
  leg_freshness smallint,
  mood smallint,
  stress smallint,
  sleep_quality smallint,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date)
);

alter table daily_wellness enable row level security;
create policy "users manage own wellness"
  on daily_wellness for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
