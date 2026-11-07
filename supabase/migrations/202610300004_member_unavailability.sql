-- Crew member leave, training and other unavailable periods used by dispatch capacity checks.

begin;

create table if not exists public.member_unavailability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  type text not null default 'leave' check (type in ('leave', 'training', 'medical', 'other')),
  reason text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_member_unavailability_org_user_dates
  on public.member_unavailability (organization_id, user_id, start_date, end_date);

alter table public.member_unavailability enable row level security;
revoke all on table public.member_unavailability from anon, authenticated;

drop trigger if exists set_member_unavailability_updated_at on public.member_unavailability;
create trigger set_member_unavailability_updated_at before update on public.member_unavailability
for each row execute function public.set_updated_at();

commit;
