-- Crew member skills, certificates and expiry tracking.

begin;

create table if not exists public.member_qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  name text not null,
  certificate_no text not null default '',
  issued_on date,
  expires_on date,
  notes text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

create index if not exists idx_member_qualifications_org_user
  on public.member_qualifications (organization_id, user_id);
create index if not exists idx_member_qualifications_expiry
  on public.member_qualifications (organization_id, expires_on)
  where expires_on is not null;

alter table public.member_qualifications enable row level security;
revoke all on table public.member_qualifications from anon, authenticated;

drop trigger if exists set_member_qualifications_updated_at on public.member_qualifications;
create trigger set_member_qualifications_updated_at before update on public.member_qualifications
for each row execute function public.set_updated_at();

commit;
