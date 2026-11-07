-- Organization-level reusable 3D templates that can seed a project model version.

begin;

create table public.model_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  description text not null default '',
  generator_model text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  cover_file_id uuid references public.files(id) on delete set null,
  manifest jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  check (jsonb_typeof(manifest) = 'object')
);

create table public.model_template_parts (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.model_templates(id) on delete cascade,
  part_key text not null,
  name text not null,
  group_name text not null default '',
  kind text not null check (kind in ('equipment', 'shell', 'context', 'site')),
  file_id uuid references public.files(id) on delete restrict,
  byte_size bigint not null default 0 check (byte_size >= 0),
  default_wbs_stable_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (template_id, part_key),
  check (jsonb_typeof(metadata) = 'object')
);

alter table public.model_versions
  add column source_template_id uuid references public.model_templates(id) on delete set null;

create index idx_model_templates_org_status
  on public.model_templates (organization_id, status, updated_at desc);

create index idx_model_template_parts_template
  on public.model_template_parts (template_id, group_name, part_key);

alter table public.model_templates enable row level security;
alter table public.model_template_parts enable row level security;
revoke all on table public.model_templates, public.model_template_parts from anon, authenticated;

drop trigger if exists set_model_templates_updated_at on public.model_templates;
create trigger set_model_templates_updated_at
before update on public.model_templates
for each row execute function public.set_updated_at();

commit;
