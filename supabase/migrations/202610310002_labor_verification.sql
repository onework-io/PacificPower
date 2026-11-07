alter table public.labor_entries
  add column if not exists status text not null default 'pending',
  add column if not exists verified_by uuid references public.app_users(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists rejection_reason text not null default '';

alter table public.labor_entries drop constraint if exists labor_entries_status_check;
alter table public.labor_entries add constraint labor_entries_status_check
  check (status in ('pending', 'approved', 'rejected'));

create index if not exists labor_entries_project_status_work_date_idx
  on public.labor_entries(project_id, status, work_date desc);

comment on column public.labor_entries.hours is 'Hours per person; total labor hours equals people multiplied by hours.';
