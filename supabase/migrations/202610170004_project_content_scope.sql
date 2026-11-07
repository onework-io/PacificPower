-- Enforce project-scoped WBS and 3D content, and add project-level settings.

begin;

alter table public.model_sets
  add constraint model_sets_id_project_key unique (id, project_id);

alter table public.model_versions
  add column project_id uuid references public.projects(id) on delete cascade;

update public.model_versions version
set project_id = model_set.project_id
from public.model_sets model_set
where model_set.id = version.model_set_id
  and version.project_id is null;

alter table public.model_versions
  alter column project_id set not null,
  add constraint model_versions_id_project_key unique (id, project_id),
  add constraint model_versions_set_project_fkey
    foreign key (model_set_id, project_id)
    references public.model_sets(id, project_id)
    on delete cascade;

alter table public.wbs_tasks
  add constraint wbs_tasks_id_project_key unique (id, project_id);

alter table public.model_parts
  add column project_id uuid references public.projects(id) on delete cascade;

update public.model_parts part
set project_id = version.project_id
from public.model_versions version
where version.id = part.model_version_id
  and part.project_id is null;

alter table public.model_parts
  alter column project_id set not null,
  add constraint model_parts_version_project_fkey
    foreign key (model_version_id, project_id)
    references public.model_versions(id, project_id)
    on delete cascade,
  add constraint model_parts_task_project_fkey
    foreign key (task_id, project_id)
    references public.wbs_tasks(id, project_id)
    on delete set null (task_id);

alter table public.schedule_baselines
  add constraint schedule_baselines_id_project_key unique (id, project_id);

alter table public.projects
  add column active_schedule_baseline_id uuid,
  add constraint projects_active_model_project_fkey
    foreign key (active_model_version_id, id)
    references public.model_versions(id, project_id)
    on delete set null (active_model_version_id),
  add constraint projects_active_baseline_project_fkey
    foreign key (active_schedule_baseline_id, id)
    references public.schedule_baselines(id, project_id)
    on delete set null (active_schedule_baseline_id);

create table public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  timezone text not null default 'Asia/Taipei',
  work_hours_per_day numeric(5, 2) not null default 8 check (work_hours_per_day > 0 and work_hours_per_day <= 24),
  work_days smallint[] not null default array[1, 2, 3, 4, 5],
  wbs_code_prefix text not null default '',
  auto_recalculate_schedule boolean not null default true,
  viewer_initial_camera jsonb not null default '{}'::jsonb,
  camera_tour_enabled boolean not null default true,
  version integer not null default 1 check (version > 0),
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (work_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);

insert into public.project_settings (project_id)
select id from public.projects
on conflict (project_id) do nothing;

alter table public.project_settings enable row level security;
revoke all on table public.project_settings from anon, authenticated;

drop trigger if exists set_project_settings_updated_at on public.project_settings;
create trigger set_project_settings_updated_at
before update on public.project_settings
for each row execute function public.set_updated_at();

create index idx_model_versions_project_status
  on public.model_versions (project_id, status, version_number desc);

create index idx_model_parts_project_task
  on public.model_parts (project_id, task_id);

commit;
