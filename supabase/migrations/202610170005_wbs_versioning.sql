-- Project-scoped WBS version history and approval workflow.

begin;

create table public.wbs_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  label text not null,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'published', 'superseded', 'rejected')),
  source text not null default 'manual'
    check (source in ('manual', 'excel', 'copy', 'restore', 'migration')),
  based_on_version_id uuid,
  source_file_id uuid references public.files(id) on delete set null,
  snapshot jsonb not null default '{}'::jsonb,
  content_hash text,
  change_summary jsonb not null default '{}'::jsonb,
  change_note text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references public.app_users(id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version_number),
  unique (id, project_id),
  constraint wbs_versions_parent_project_fkey
    foreign key (based_on_version_id, project_id)
    references public.wbs_versions(id, project_id)
    on delete set null (based_on_version_id),
  check (jsonb_typeof(snapshot) = 'object'),
  check (jsonb_typeof(change_summary) = 'object'),
  check (status <> 'published' or (approved_at is not null and published_at is not null))
);

alter table public.projects
  add column active_wbs_version_id uuid,
  add constraint projects_active_wbs_version_project_fkey
    foreign key (active_wbs_version_id, id)
    references public.wbs_versions(id, project_id)
    on delete set null (active_wbs_version_id);

alter table public.project_settings
  add column wbs_approval_required boolean not null default true,
  add column wbs_auto_snapshot_before_import boolean not null default true,
  add column wbs_version_label_pattern text not null default 'V{number}';

alter table public.wbs_tasks
  add column archived_at timestamptz;

create table public.wbs_version_events (
  id bigint generated always as identity primary key,
  wbs_version_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null
    check (event_type in ('created', 'updated', 'submitted', 'approved', 'rejected', 'published', 'superseded')),
  actor_user_id uuid references public.app_users(id) on delete set null,
  note text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint wbs_version_events_version_project_fkey
    foreign key (wbs_version_id, project_id)
    references public.wbs_versions(id, project_id)
    on delete cascade,
  check (jsonb_typeof(metadata) = 'object')
);

create index idx_wbs_versions_project_status
  on public.wbs_versions (project_id, status, version_number desc);

create unique index uq_wbs_versions_one_published_per_project
  on public.wbs_versions (project_id)
  where status = 'published';

create index idx_wbs_version_events_version_created
  on public.wbs_version_events (wbs_version_id, created_at desc);

create index idx_wbs_tasks_project_active_sequence
  on public.wbs_tasks (project_id, sequence)
  where archived_at is null;

alter table public.wbs_versions enable row level security;
alter table public.wbs_version_events enable row level security;
revoke all on table public.wbs_versions, public.wbs_version_events from anon, authenticated;
revoke all on sequence public.wbs_version_events_id_seq from anon, authenticated;

drop trigger if exists set_wbs_versions_updated_at on public.wbs_versions;
create trigger set_wbs_versions_updated_at
before update on public.wbs_versions
for each row execute function public.set_updated_at();

commit;
