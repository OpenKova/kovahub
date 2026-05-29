create index if not exists packages_search_document_idx
  on packages using gin (
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' ||
      coalesce(display_name, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      array_to_string(topics, ' ') || ' ' ||
      coalesce(runtime_id, '') || ' ' ||
      coalesce(capabilities::text, '') || ' ' ||
      coalesce(compatibility::text, '')
    )
  )
  where deleted_at is null;

create index if not exists packages_topics_gin_idx on packages using gin (topics);
create index if not exists packages_updated_not_deleted_idx on packages (updated_at desc) where deleted_at is null;
