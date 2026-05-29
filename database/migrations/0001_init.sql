create extension if not exists pgcrypto;

do $$
begin
  create type package_family as enum ('skill', 'code-plugin', 'bundle-plugin');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type package_channel as enum ('official', 'community', 'private');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type verification_tier as enum (
    'structural',
    'source-linked',
    'provenance-verified',
    'rebuild-verified'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  email text not null unique,
  password_hash text not null,
  display_name text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text not null,
  family package_family not null,
  channel package_channel not null default 'community',
  owner_id uuid not null references users(id) on delete restrict,
  summary text,
  runtime_id text,
  latest_version text,
  is_official boolean not null default false,
  compatibility jsonb,
  capabilities jsonb,
  verification jsonb,
  stats jsonb not null default '{"downloads":0,"installs":0,"stars":0,"versions":0}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  version text not null,
  changelog text not null default '',
  archive_storage_key text not null,
  sha256hash text not null,
  dist_tags text[] not null default '{}',
  compatibility jsonb,
  capabilities jsonb,
  verification jsonb,
  created_at timestamptz not null default now(),
  unique (package_id, version)
);

create table if not exists package_files (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references package_versions(id) on delete cascade,
  path text not null,
  size_bytes bigint not null,
  sha256 text not null,
  content_type text,
  unique (package_version_id, path)
);

create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists packages_family_updated_idx on packages (family, updated_at desc);
create index if not exists packages_owner_idx on packages (owner_id);
create index if not exists package_versions_package_created_idx on package_versions (package_id, created_at desc);
