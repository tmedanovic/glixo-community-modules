create table if not exists schema_migrations (id text primary key, applied_at integer not null);
create table if not exists pull_requests (
  id text primary key,
  external_key text not null unique,
  title text not null,
  state text,
  repo_full_name text,
  url text,
  updated_at integer not null
);
create table if not exists event_outbox (
  seq integer primary key autoincrement,
  event_type text not null,
  payload_json text not null,
  occurred_at integer not null
);
