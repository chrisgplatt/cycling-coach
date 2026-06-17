-- Coach signals whether athlete should explore training adaptations after this session.
alter table session_feedback add column if not exists recommend_adaptations boolean;
