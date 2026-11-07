create table if not exists public.daily_report_tasks (
  daily_report_id uuid not null references public.daily_reports(id) on delete cascade,
  task_id uuid not null references public.wbs_tasks(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (daily_report_id, task_id)
);

create table if not exists public.daily_report_labor_entries (
  daily_report_id uuid not null references public.daily_reports(id) on delete cascade,
  labor_entry_id uuid not null references public.labor_entries(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (daily_report_id, labor_entry_id)
);

create index if not exists daily_report_tasks_task_idx
  on public.daily_report_tasks(task_id);

create index if not exists daily_report_labor_entries_entry_idx
  on public.daily_report_labor_entries(labor_entry_id);

comment on table public.daily_report_tasks is 'WBS tasks explicitly included in a daily site report.';
comment on table public.daily_report_labor_entries is 'Approved labor entries explicitly included in a daily site report.';
