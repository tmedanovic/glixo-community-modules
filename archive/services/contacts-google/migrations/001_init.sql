create table if not exists schema_migrations (id text primary key, applied_at integer not null);
create table if not exists contacts (
  id text primary key, external_id text not null unique, display_name text not null,
  email text, phone text, updated_at integer not null
);
