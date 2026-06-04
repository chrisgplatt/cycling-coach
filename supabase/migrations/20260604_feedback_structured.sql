-- Structured post-ride feedback signal (all optional, additive).
alter table session_feedback add column if not exists rpe smallint;
alter table session_feedback add column if not exists feel smallint;
alter table session_feedback add column if not exists completion text;
alter table session_feedback add column if not exists tags text[];
alter table session_feedback add column if not exists mood smallint;
