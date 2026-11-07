-- Persistent cross-project crew dispatching and workload planning.

begin;

create table if not exists public.crew_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  crew_name text not null check (length(trim(crew_name)) > 0),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.wbs_tasks(id) on delete set null,
  start_date date not null,
  end_date date not null,
  planned_people numeric(8,2) not null default 1 check (planned_people > 0),
  daily_hours numeric(8,2) not null default 8 check (daily_hours > 0 and daily_hours <= 24),
  status text not null default 'planned' check (status in ('planned', 'confirmed', 'completed', 'cancelled')),
  note text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_crew_dispatches_org_dates
  on public.crew_dispatches (organization_id, start_date, end_date);
create index if not exists idx_crew_dispatches_crew_dates
  on public.crew_dispatches (organization_id, crew_name, start_date, end_date);
create index if not exists idx_crew_dispatches_project
  on public.crew_dispatches (project_id, task_id);

alter table public.crew_dispatches enable row level security;
revoke all on table public.crew_dispatches from anon, authenticated;

drop trigger if exists set_crew_dispatches_updated_at on public.crew_dispatches;
create trigger set_crew_dispatches_updated_at before update on public.crew_dispatches
for each row execute function public.set_updated_at();

commit;
