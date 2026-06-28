-- Module-owned schema (relationalDb.module)
create table if not exists schema_migrations (
  id text primary key,
  applied_at integer not null
);

create table if not exists auth_account (
  id text primary key,
  user_id text not null,
  tenant_id text,
  account_oid text,
  client_id text,
  refresh_token_cipher text,
  health_status text not null default 'unknown',
  health_detail text,
  connected_at integer,
  updated_at integer not null
);

create table if not exists conversations (
  id text primary key,
  user_id text not null,
  thread_id text not null,
  title text not null,
  preview text,
  unread_count integer not null default 0,
  updated_at integer not null,
  kind text not null default 'chat',
  unique(user_id, thread_id)
);

create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations(id),
  user_id text not null,
  role text not null,
  author_name text,
  body text not null,
  external_id text,
  sent_at integer not null,
  unique(conversation_id, external_id)
);

create table if not exists event_outbox (
  seq integer primary key autoincrement,
  event_type text not null,
  payload_json text not null,
  occurred_at integer not null
);

create index if not exists idx_messages_conversation on messages(conversation_id, sent_at);
create index if not exists idx_conversations_user on conversations(user_id, updated_at desc);
