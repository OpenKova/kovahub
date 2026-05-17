alter table package_reports
  add column if not exists assigned_to_id uuid references users(id) on delete set null,
  add column if not exists assigned_at timestamptz;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  package_name text,
  report_id uuid references package_reports(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists package_reports_assigned_to_idx on package_reports (assigned_to_id, status, created_at desc);
create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on notifications (user_id, created_at desc) where read_at is null;
