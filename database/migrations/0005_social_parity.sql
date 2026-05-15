create table if not exists package_stars (
  package_id uuid not null references packages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (package_id, user_id)
);

create index if not exists package_stars_user_created_idx on package_stars (user_id, created_at desc);

create table if not exists package_comments (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  body text not null,
  report_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists package_comments_package_created_idx on package_comments (package_id, created_at asc);

create table if not exists package_reports (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists package_reports_package_created_idx on package_reports (package_id, created_at desc);
