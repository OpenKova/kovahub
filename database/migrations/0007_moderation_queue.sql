alter table package_reports
  add column if not exists status text not null default 'open',
  add column if not exists resolution text,
  add column if not exists resolved_by_id uuid references users(id) on delete set null,
  add column if not exists resolved_at timestamptz;

create index if not exists package_reports_status_created_idx
  on package_reports (status, created_at desc);
