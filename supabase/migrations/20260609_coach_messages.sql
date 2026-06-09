-- Unified cross-surface conversation log.
create table if not exists coach_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  surface     text not null check (surface in ('coach','plan','workout','feedback','interview')),
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  context     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists coach_messages_user_created_idx
  on coach_messages (user_id, created_at desc);

create index if not exists coach_messages_context_idx
  on coach_messages using gin (context)
  where context is not null;

alter table coach_messages enable row level security;

create policy "own data" on coach_messages
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Idempotent backfill: chat_messages → coach_messages (surface='coach')
insert into coach_messages (id, user_id, surface, role, content, context, created_at)
select id, user_id, 'coach', role, content, null, created_at
from chat_messages
where not exists (
  select 1 from coach_messages cm where cm.id = chat_messages.id
);

-- Idempotent backfill: feedback_messages → coach_messages (surface='feedback')
insert into coach_messages (id, user_id, surface, role, content, context, created_at)
select id, user_id, 'feedback', role, content,
  jsonb_build_object('feedback_id', feedback_id),
  created_at
from feedback_messages
where not exists (
  select 1 from coach_messages cm where cm.id = feedback_messages.id
);
