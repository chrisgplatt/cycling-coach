-- Admin flag on user_profile
-- Run in Supabase SQL editor (Project → SQL Editor → New query)

alter table user_profile
  add column if not exists is_admin boolean not null default false;

-- Grant admin to the owner account
update user_profile
set is_admin = true
where user_id = (select id from auth.users where email = 'chrisgplatt@googlemail.com');
