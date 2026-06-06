-- Feedback conversation: the athlete can rate the coach's post-ride note and
-- discuss the session in a thread anchored to the feedback entry. The rating is a
-- coaching-quality signal for belief synthesis; the thread feeds the dossier.

-- How useful the athlete found the coach's note (null = unrated).
alter table session_feedback add column if not exists coach_note_rating text
  check (coach_note_rating is null or coach_note_rating in ('helpful','not_helpful'));

-- The two-way thread. The coach's note itself lives on session_feedback.coach_note
-- (rendered as the opening assistant turn); this table holds only the conversation.
create table if not exists feedback_messages (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references session_feedback(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_messages_feedback_idx
  on feedback_messages (feedback_id, created_at);

alter table feedback_messages enable row level security;
create policy "own data" on feedback_messages
  using (user_id = auth.uid()) with check (user_id = auth.uid());
