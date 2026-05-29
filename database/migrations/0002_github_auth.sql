alter table users add column if not exists github_id text;
alter table users add column if not exists auth_provider text not null default 'password';

create unique index if not exists users_github_id_unique_idx
  on users (github_id)
  where github_id is not null;
