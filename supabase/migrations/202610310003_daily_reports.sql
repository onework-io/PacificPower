create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  crew_name text not null default '',
  weather text not null default '',
  work_summary text not null default '',
  issues text not null default '',
  safety_notes text not null default '',
  next_plan text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reported_by uuid references public.app_users(id) on delete set null,
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_images add column if not exists daily_report_id uuid references public.daily_reports(id) on delete cascade;
create index if not exists daily_reports_project_date_idx on public.daily_reports(project_id, report_date desc);
create index if not exists project_images_daily_report_idx on public.project_images(daily_report_id) where daily_report_id is not null;
