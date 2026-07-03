alter table user_profile add column if not exists garmin_last_sync_at timestamptz;
alter table user_profile add column if not exists garmin_last_sync_device text;
