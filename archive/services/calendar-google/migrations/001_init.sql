create table if not exists schema_migrations (id text primary key, applied_at integer not null);
create table if not exists calendar_events (
  id text primary key, external_id text not null unique, title text not null,
  starts_at integer not null, ends_at integer, location text, updated_at integer not null
);
create table if not exists event_outbox (
  seq integer primary key autoincrement, event_type text not null,
  payload_json text not null, occurred_at integer not null
);
