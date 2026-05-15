alter table packages
  add column if not exists topics text[] not null default '{}';

create index if not exists packages_topics_idx on packages using gin (topics);

drop index if exists packages_search_idx;
create index if not exists packages_search_idx on packages using gin (
  to_tsvector(
    'simple',
    coalesce(name, '') || ' ' || coalesce(display_name, '') || ' ' || coalesce(summary, '') || ' ' || array_to_string(topics, ' ')
  )
);
