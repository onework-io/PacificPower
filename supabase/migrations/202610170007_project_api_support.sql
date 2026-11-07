-- Backend project CRUD support: idempotent create requests and reversible archive status.

begin;

alter table public.projects
  add column if not exists status_before_archive text
    check (status_before_archive is null or status_before_archive in ('planning', 'active', 'inspection', 'completed'));

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  operation text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, operation, key)
);

create index if not exists idx_idempotency_keys_expiry on public.idempotency_keys (expires_at);

alter table public.idempotency_keys enable row level security;
revoke all on table public.idempotency_keys from anon, authenticated;

commit;
