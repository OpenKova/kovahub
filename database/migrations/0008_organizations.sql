create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  display_name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'maintainer', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_idx
  on organization_members (user_id);

alter table packages
  add column if not exists publisher_type text not null default 'user',
  add column if not exists publisher_handle text;

update packages
set publisher_type = 'user'
where publisher_type is null;

create index if not exists packages_publisher_handle_idx
  on packages (publisher_handle)
  where publisher_handle is not null;
