-- Shared recordings (#116). Rows are written and read only by server
-- routes holding the service role key; browsers never query this table
-- directly, so RLS is enabled with no anon/authenticated policies.

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  title text not null
    check (char_length(title) between 1 and 100),
  author_name text not null
    check (char_length(author_name) between 1 and 50),
  device_id text not null
    check (char_length(device_id) between 1 and 128),
  bpm integer not null check (bpm between 20 and 400),
  duration_ms integer not null check (duration_ms >= 0),
  note_count integer not null check (note_count >= 0),
  notes jsonb not null check (jsonb_typeof(notes) = 'array'),
  delete_token_hash text not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.recordings is
  'Shared MakeShift note-list recordings; server access only.';
comment on column public.recordings.delete_token_hash is
  'SHA-256 hex digest of the per-recording delete token; never the token.';

create index recordings_visible_created_at_idx
  on public.recordings (created_at desc)
  where not hidden;

create index recordings_device_id_idx on public.recordings (device_id);

alter table public.recordings enable row level security;

revoke all on table public.recordings from anon, authenticated;
