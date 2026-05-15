alter table packages
  add column if not exists deleted_at timestamptz;

alter table package_versions
  add column if not exists yanked_at timestamptz,
  add column if not exists yank_message text;

create index if not exists packages_active_updated_idx
  on packages (updated_at desc)
  where deleted_at is null;
