-- PacificPower engineering management platform
-- Initial Supabase PostgreSQL schema. Large binary files remain in MinIO.

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  external_subject text unique,
  email text not null unique,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null check (role in ('admin', 'project_manager', 'site_engineer', 'crew', 'owner', 'auditor')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket text not null check (bucket in ('models', 'site-photos', 'project-images', 'imports')),
  object_key text not null,
  original_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text,
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'blocked', 'failed')),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, object_key)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  description text not null default '',
  client_name text not null default '',
  location text not null default '',
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  generator_model text not null default '',
  crew_name text not null default '',
  contract_amount numeric(16, 2) check (contract_amount is null or contract_amount >= 0),
  status text not null default 'planning' check (status in ('planning', 'active', 'inspection', 'completed', 'archived')),
  risk_status text not null default 'normal' check (risk_status in ('normal', 'attention', 'high')),
  start_date date,
  end_date date,
  manager_id uuid references public.app_users(id) on delete set null,
  active_model_version_id uuid,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null check (role in ('project_manager', 'site_engineer', 'crew', 'owner', 'auditor')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_images (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete restrict,
  kind text not null default 'gallery' check (kind in ('cover', 'gallery')),
  caption text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.wbs_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stable_key text not null,
  code text not null,
  sequence integer not null check (sequence > 0),
  name text not null,
  phase text not null,
  duration_days numeric(8, 2) not null default 1 check (duration_days > 0),
  weight_pct numeric(7, 4) check (weight_pct is null or (weight_pct >= 0 and weight_pct <= 100)),
  progress_pct numeric(7, 4) not null default 0 check (progress_pct >= 0 and progress_pct <= 100),
  pinned_start_day numeric(8, 2) check (pinned_start_day is null or pinned_start_day >= 0),
  lag_days numeric(8, 2) not null default 0 check (lag_days >= 0),
  model_part_key text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, stable_key),
  unique (project_id, code),
  unique (project_id, sequence)
);

create table if not exists public.task_dependencies (
  predecessor_task_id uuid not null references public.wbs_tasks(id) on delete cascade,
  successor_task_id uuid not null references public.wbs_tasks(id) on delete cascade,
  relation_type text not null default 'FS' check (relation_type in ('FS', 'SS', 'FF', 'SF')),
  lag_days numeric(8, 2) not null default 0 check (lag_days >= 0),
  created_at timestamptz not null default now(),
  primary key (predecessor_task_id, successor_task_id),
  check (predecessor_task_id <> successor_task_id)
);

create table if not exists public.schedule_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  project_start date not null,
  snapshot jsonb not null,
  approved_by uuid references public.app_users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source text not null check (source in ('manual', 'excel', 'migration')),
  source_file_id uuid references public.files(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.progress_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.wbs_tasks(id) on delete cascade,
  data_date date not null,
  progress_pct numeric(7, 4) not null check (progress_pct >= 0 and progress_pct <= 100),
  note text not null default '',
  source text not null default 'manual' check (source in ('manual', 'import', 'ai_confirmed')),
  reported_by uuid references public.app_users(id) on delete set null,
  supersedes_id uuid references public.progress_updates(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  data_date date not null,
  planned_pct numeric(7, 4) not null check (planned_pct >= 0 and planned_pct <= 100),
  earned_pct numeric(7, 4) not null check (earned_pct >= 0 and earned_pct <= 100),
  created_at timestamptz not null default now(),
  unique (project_id, data_date)
);

create table if not exists public.labor_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.labor_plans (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.wbs_tasks(id) on delete cascade,
  labor_category_id uuid not null references public.labor_categories(id) on delete restrict,
  planned_people numeric(8, 2) not null default 0 check (planned_people >= 0),
  hours_per_day numeric(8, 2) not null default 8 check (hours_per_day > 0),
  planned_hours numeric(12, 2) not null default 0 check (planned_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, labor_category_id)
);

create table if not exists public.labor_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.wbs_tasks(id) on delete cascade,
  labor_category_id uuid references public.labor_categories(id) on delete set null,
  work_date date not null,
  people numeric(8, 2) not null default 1 check (people >= 0),
  hours numeric(12, 2) not null check (hours >= 0),
  crew_name text not null default '',
  note text not null default '',
  reported_by uuid references public.app_users(id) on delete set null,
  supersedes_id uuid references public.labor_entries(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.model_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null default '主模型',
  created_at timestamptz not null default now()
);

create table if not exists public.model_versions (
  id uuid primary key default gen_random_uuid(),
  model_set_id uuid not null references public.model_sets(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'published', 'failed', 'archived')),
  source_file_id uuid references public.files(id) on delete set null,
  manifest jsonb not null default '{}'::jsonb,
  error_message text,
  uploaded_by uuid references public.app_users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (model_set_id, version_number)
);

alter table public.projects
  drop constraint if exists projects_active_model_version_id_fkey;
alter table public.projects
  add constraint projects_active_model_version_id_fkey
  foreign key (active_model_version_id) references public.model_versions(id) on delete set null;

create table if not exists public.model_parts (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.model_versions(id) on delete cascade,
  task_id uuid references public.wbs_tasks(id) on delete set null,
  part_key text not null,
  name text not null,
  group_name text not null default '',
  kind text not null check (kind in ('equipment', 'shell', 'context', 'site')),
  file_id uuid references public.files(id) on delete set null,
  byte_size bigint not null default 0 check (byte_size >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (model_version_id, part_key)
);

create table if not exists public.pois (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  model_version_id uuid references public.model_versions(id) on delete set null,
  model_part_id uuid references public.model_parts(id) on delete set null,
  position_x double precision not null,
  position_y double precision not null,
  position_z double precision not null,
  title text not null,
  url text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.wbs_tasks(id) on delete set null,
  file_id uuid not null references public.files(id) on delete restrict,
  thumbnail_file_id uuid references public.files(id) on delete set null,
  captured_at timestamptz,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  note text not null default '',
  uploaded_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ai_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  structured_result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  thread_id uuid references public.ai_threads(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  model_name text,
  input_summary jsonb not null default '{}'::jsonb,
  error_message text,
  requested_by uuid references public.app_users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_analysis_photos (
  analysis_job_id uuid not null references public.ai_analysis_jobs(id) on delete cascade,
  photo_id uuid not null references public.site_photos(id) on delete cascade,
  primary key (analysis_job_id, photo_id)
);

create table if not exists public.ai_analysis_results (
  id uuid primary key default gen_random_uuid(),
  analysis_job_id uuid not null unique references public.ai_analysis_jobs(id) on delete cascade,
  answer text not null,
  estimated_progress_pct numeric(7, 4) check (estimated_progress_pct is null or (estimated_progress_pct >= 0 and estimated_progress_pct <= 100)),
  focus_task_id uuid references public.wbs_tasks(id) on delete set null,
  confidence numeric(6, 5) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence jsonb not null default '[]'::jsonb,
  confirmed_by uuid references public.app_users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('wbs_excel', 'local_data')),
  file_id uuid references public.files(id) on delete set null,
  status text not null default 'uploaded' check (status in ('uploaded', 'validating', 'validated', 'applying', 'succeeded', 'failed')),
  validation_result jsonb not null default '{}'::jsonb,
  error_message text,
  requested_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  actor_user_id uuid references public.app_users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_org_status on public.projects (organization_id, status);
create index if not exists idx_project_members_user on public.project_members (user_id, project_id);
create index if not exists idx_wbs_tasks_project_sequence on public.wbs_tasks (project_id, sequence);
create index if not exists idx_progress_updates_task_date on public.progress_updates (task_id, data_date desc, created_at desc);
create index if not exists idx_progress_snapshots_project_date on public.progress_snapshots (project_id, data_date);
create index if not exists idx_labor_entries_project_date on public.labor_entries (project_id, work_date);
create index if not exists idx_labor_entries_task_date on public.labor_entries (task_id, work_date);
create index if not exists idx_model_versions_set_status on public.model_versions (model_set_id, status);
create index if not exists idx_site_photos_project_created on public.site_photos (project_id, created_at desc);
create index if not exists idx_ai_jobs_project_status on public.ai_analysis_jobs (project_id, status, created_at desc);
create index if not exists idx_audit_logs_project_created on public.audit_logs (project_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'app_users', 'organization_members', 'files', 'projects',
    'project_members', 'project_images', 'wbs_tasks', 'task_dependencies',
    'schedule_baselines', 'schedule_revisions', 'progress_updates', 'progress_snapshots',
    'labor_categories', 'labor_plans', 'labor_entries', 'model_sets', 'model_versions',
    'model_parts', 'pois', 'site_photos', 'ai_threads', 'ai_messages',
    'ai_analysis_jobs', 'ai_analysis_photos', 'ai_analysis_results', 'import_jobs', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end $$;

revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'app_users', 'projects', 'wbs_tasks', 'labor_categories', 'labor_plans',
    'model_versions', 'pois', 'ai_threads', 'import_jobs'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      'set_' || table_name || '_updated_at',
      table_name
    );
  end loop;
end $$;

insert into public.organizations (code, name)
values ('PACIFICPOWER', 'PacificPower')
on conflict (code) do update set name = excluded.name;

insert into public.labor_categories (organization_id, code, name)
select organization_id, seed.code, seed.name
from (select id as organization_id from public.organizations where code = 'PACIFICPOWER') organization
cross join (values
  ('survey', '放樣技師'),
  ('civil', '泥作技工'),
  ('rigging', '吊裝技工'),
  ('mechanical', '機械技工'),
  ('piping', '配管技工'),
  ('electrical', '電氣技工'),
  ('testing', '試車技師'),
  ('general', '一般技工')
) as seed(code, name)
on conflict (organization_id, code) do update set name = excluded.name, active = true;

commit;
