alter table package_versions
  add column if not exists documentation jsonb;
