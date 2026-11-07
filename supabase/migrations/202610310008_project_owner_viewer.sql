begin;

alter table public.project_members
  drop constraint if exists project_members_role_check;

alter table public.project_members
  add constraint project_members_role_check
  check (role in ('planner', 'manager', 'worker', 'viewer'));

comment on column public.project_members.role is
  'Project-scoped responsibility. viewer is the owner/read-only preset and is not an organization account role.';

commit;
