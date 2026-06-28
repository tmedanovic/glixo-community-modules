create table if not exists schema_migrations (id text primary key, applied_at integer not null);
create table if not exists auth_account (
  id text primary key, user_id text not null, refresh_token_cipher text,
  account_handle text, health_status text not null default 'unknown', updated_at integer not null
);
create table if not exists conversations (
  id text primary key, user_id text not null, thread_id text not null unique,
  title text not null, preview text, unread_count integer not null default 0,
  updated_at integer not null
);
create table if not exists messages (
  id text primary key, conversation_id text not null, body text not null,
  external_id text unique, sent_at integer not null
);
create table if not exists event_outbox (
  seq integer primary key autoincrement, event_type text not null,
  payload_json text not null, occurred_at integer not null
);
