alter table public.daily_report_tasks
  drop constraint if exists daily_report_tasks_task_id_fkey;

alter table public.daily_report_tasks
  add constraint daily_report_tasks_task_id_fkey
  foreign key (task_id) references public.wbs_tasks(id) on delete cascade;

alter table public.daily_report_labor_entries
  drop constraint if exists daily_report_labor_entries_labor_entry_id_fkey;

alter table public.daily_report_labor_entries
  add constraint daily_report_labor_entries_labor_entry_id_fkey
  foreign key (labor_entry_id) references public.labor_entries(id) on delete cascade;
