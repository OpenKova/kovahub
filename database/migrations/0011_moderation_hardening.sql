alter table users
  add column if not exists banned_at timestamptz,
  add column if not exists ban_reason text;

create index if not exists users_banned_at_idx
  on users (banned_at)
  where banned_at is not null;
