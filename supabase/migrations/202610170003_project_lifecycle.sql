-- Project lifecycle fields used by archive, restore and delayed purge workflows.

begin;

alter table public.projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.app_users(id) on delete set null,
  add column if not exists deletion_reason text;

create index if not exists idx_projects_active_org_updated
  on public.projects (organization_id, updated_at desc)
  where deleted_at is null;

create index if not exists idx_projects_deleted_at
  on public.projects (deleted_at)
  where deleted_at is not null;

commit;
