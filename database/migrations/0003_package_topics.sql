alter table packages
  add column if not exists topics text[] not null default '{}';

create index if not exists packages_topics_idx on packages using gin (topics);
