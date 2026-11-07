-- Four-role RBAC, per-account permission overrides, and account lifecycle metadata.

begin;

alter table public.app_users drop constraint if exists app_users_status_check;
alter table public.app_users
  add column if not exists phone text,
  add column if not exists department text not null default '',
  add column if not exists crew_name text not null default '',
  add column if not exists mfa_enabled boolean not null default false,
  add column if not exists last_login_at timestamptz,
  add column if not exists version integer not null default 1 check (version > 0);
alter table public.app_users
  add constraint app_users_status_check
  check (status in ('invited', 'active', 'suspended', 'locked', 'disabled'));

create table if not exists public.roles (
  code text primary key check (code in ('admin', 'planner', 'manager', 'worker')),
  name text not null,
  description text not null default '',
  sort_order smallint not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  code text primary key,
  module text not null,
  name text not null,
  description text not null default '',
  sensitive boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table if not exists public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  effect text not null check (effect in ('allow', 'deny')),
  scope_type text not null default 'organization'
    check (scope_type in ('organization', 'project', 'assigned_task')),
  project_id uuid references public.projects(id) on delete cascade,
  expires_at timestamptz,
  reason text not null default '',
  granted_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope_type = 'project' and project_id is not null) or (scope_type <> 'project' and project_id is null)),
  unique nulls not distinct (organization_id, user_id, permission_code, scope_type, project_id)
);

create table if not exists public.task_assignments (
  task_id uuid not null references public.wbs_tasks(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  assigned_by uuid references public.app_users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  ends_at timestamptz,
  primary key (task_id, user_id)
);

insert into public.roles (code, name, description, sort_order) values
  ('admin', '系統管理員', '管理帳號、權限、專案及系統設定', 10),
  ('planner', '進度規劃員', '規劃 WBS、排程、PERT 與版本送審', 20),
  ('manager', '專案管理者', '核准計畫、查看報表及調度工班', 30),
  ('worker', '現場人員', '回報被指派工項的進度、人工時與照片', 40)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.permissions (code, module, name, sensitive, sort_order) values
  ('account.view', '帳號管理', '查看帳號', true, 10),
  ('account.create', '帳號管理', '建立及邀請帳號', true, 20),
  ('account.edit', '帳號管理', '編輯帳號', true, 30),
  ('account.disable', '帳號管理', '停用帳號', true, 40),
  ('account.permission.manage', '帳號管理', '設定角色及個別權限', true, 50),
  ('audit.view', '帳號管理', '查看操作紀錄', true, 60),
  ('project.view', '專案', '查看專案', false, 100),
  ('project.create', '專案', '建立專案', true, 110),
  ('project.edit', '專案', '編輯專案', false, 120),
  ('project.archive', '專案', '封存專案', true, 130),
  ('project.restore', '專案', '還原專案', true, 140),
  ('project.member.manage', '專案', '管理專案成員', true, 150),
  ('wbs.view', 'WBS 與排程', '查看 WBS', false, 200),
  ('wbs.edit', 'WBS 與排程', '編輯 WBS', false, 210),
  ('wbs.import', 'WBS 與排程', '匯入 WBS', false, 220),
  ('wbs.submit', 'WBS 與排程', '送審 WBS', false, 230),
  ('wbs.approve', 'WBS 與排程', '核准 WBS', true, 240),
  ('wbs.publish', 'WBS 與排程', '發布 WBS', true, 250),
  ('model.view', '3D 模型', '查看 3D 模型', false, 300),
  ('model.upload', '3D 模型', '上傳 3D 模型', false, 310),
  ('model.mapping.edit', '3D 模型', '編輯 WBS 對應', false, 320),
  ('model.publish', '3D 模型', '發布 3D 模型', true, 330),
  ('progress.view', '現場進度', '查看進度', false, 400),
  ('progress.report', '現場進度', '回報進度', false, 410),
  ('progress.verify', '現場進度', '確認進度', true, 420),
  ('photo.upload', '現場進度', '上傳現場照片', false, 430),
  ('ai.assistant.use', '現場進度', '使用 AI 問答', false, 440),
  ('ai.progress.confirm', '現場進度', '確認 AI 進度', true, 450),
  ('labor.view', '工班與人工時', '查看人工時', false, 500),
  ('labor.dispatch', '工班與人工時', '調度工班', true, 510),
  ('labor.report', '工班與人工時', '回報人工時', false, 520),
  ('labor.verify', '工班與人工時', '確認人工時', true, 530),
  ('report.project.view', '報表', '查看專案報表', false, 600),
  ('report.portfolio.view', '報表', '查看跨專案報表', true, 610),
  ('report.export', '報表', '匯出報表', true, 620),
  ('report.contract_amount.view', '報表', '查看承攬金額', true, 630)
on conflict (code) do update set
  module = excluded.module,
  name = excluded.name,
  sensitive = excluded.sensitive,
  sort_order = excluded.sort_order;

insert into public.role_permissions (role_code, permission_code)
select 'admin', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('planner', 'project.view'), ('planner', 'wbs.view'), ('planner', 'wbs.edit'),
  ('planner', 'wbs.import'), ('planner', 'wbs.submit'), ('planner', 'model.view'),
  ('planner', 'model.upload'), ('planner', 'model.mapping.edit'), ('planner', 'progress.view'),
  ('planner', 'labor.view'), ('planner', 'report.project.view'),
  ('manager', 'project.view'), ('manager', 'project.edit'), ('manager', 'project.member.manage'),
  ('manager', 'wbs.view'), ('manager', 'wbs.approve'), ('manager', 'wbs.publish'),
  ('manager', 'model.view'), ('manager', 'model.publish'), ('manager', 'progress.view'),
  ('manager', 'progress.report'), ('manager', 'progress.verify'), ('manager', 'photo.upload'),
  ('manager', 'ai.assistant.use'), ('manager', 'ai.progress.confirm'), ('manager', 'labor.view'),
  ('manager', 'labor.dispatch'), ('manager', 'labor.report'), ('manager', 'labor.verify'),
  ('manager', 'report.project.view'), ('manager', 'report.portfolio.view'),
  ('manager', 'report.export'), ('manager', 'report.contract_amount.view'),
  ('worker', 'project.view'), ('worker', 'wbs.view'), ('worker', 'model.view'),
  ('worker', 'progress.view'), ('worker', 'progress.report'), ('worker', 'photo.upload'),
  ('worker', 'ai.assistant.use'), ('worker', 'labor.report')
on conflict do nothing;

alter table public.organization_members drop constraint if exists organization_members_role_check;
update public.organization_members set role = case role
  when 'project_manager' then 'manager'
  when 'site_engineer' then 'planner'
  when 'crew' then 'worker'
  when 'owner' then 'manager'
  when 'auditor' then 'manager'
  else role end;
alter table public.organization_members
  add constraint organization_members_role_fkey foreign key (role) references public.roles(code);

alter table public.project_members drop constraint if exists project_members_role_check;
update public.project_members set role = case role
  when 'project_manager' then 'manager'
  when 'site_engineer' then 'planner'
  when 'crew' then 'worker'
  when 'owner' then 'manager'
  when 'auditor' then 'manager'
  else role end;
alter table public.project_members
  add constraint project_members_role_check check (role in ('planner', 'manager', 'worker'));

create index if not exists idx_permission_overrides_user
  on public.user_permission_overrides (organization_id, user_id, permission_code);
create index if not exists idx_task_assignments_user on public.task_assignments (user_id, task_id);

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.task_assignments enable row level security;

revoke all on table public.roles, public.permissions, public.role_permissions,
  public.user_permission_overrides, public.task_assignments from anon, authenticated;

drop trigger if exists set_roles_updated_at on public.roles;
create trigger set_roles_updated_at before update on public.roles
for each row execute function public.set_updated_at();

drop trigger if exists set_user_permission_overrides_updated_at on public.user_permission_overrides;
create trigger set_user_permission_overrides_updated_at before update on public.user_permission_overrides
for each row execute function public.set_updated_at();

commit;
