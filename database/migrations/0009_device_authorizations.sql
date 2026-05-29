create table if not exists device_authorizations (
  device_code text primary key,
  user_code text not null unique,
  client_name text,
  user_id uuid references users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'consumed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz
);

create index if not exists device_authorizations_user_code_idx
  on device_authorizations (user_code);

create index if not exists device_authorizations_expires_idx
  on device_authorizations (expires_at);
