-- Managed crew directory. User membership remains compatible with app_users.crew_name.

begin;

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  trade text not null default '',
  leader_user_id uuid references public.app_users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  daily_capacity_hours numeric(10,2) not null default 8 check (daily_capacity_hours > 0),
  notes text not null default '',
  version integer not null default 1 check (version > 0),
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, name)
);

insert into public.crews (organization_id, code, name)
select distinct p.organization_id,
  'CREW-' || upper(substr(md5(trim(p.crew_name)), 1, 8)),
  trim(p.crew_name)
from public.projects p
where length(trim(p.crew_name)) > 0
on conflict (organization_id, name) do nothing;

insert into public.crews (organization_id, code, name)
select distinct om.organization_id,
  'CREW-' || upper(substr(md5(trim(u.crew_name)), 1, 8)),
  trim(u.crew_name)
from public.organization_members om
join public.app_users u on u.id = om.user_id
where length(trim(u.crew_name)) > 0
on conflict (organization_id, name) do nothing;

create index if not exists idx_crews_organization_status on public.crews (organization_id, status, name);
alter table public.crews enable row level security;
revoke all on table public.crews from anon, authenticated;

drop trigger if exists set_crews_updated_at on public.crews;
create trigger set_crews_updated_at before update on public.crews
for each row execute function public.set_updated_at();

commit;
