alter table public.files drop constraint if exists files_bucket_check;
alter table public.files add constraint files_bucket_check
  check (bucket in ('models', 'site-photos', 'project-images', 'imports', 'documents'));

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_id uuid not null unique references public.files(id) on delete cascade,
  category text not null default 'other'
    check (category in ('drawing', 'contract', 'inspection', 'manual', 'photo', 'model', 'other')),
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  uploaded_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_documents_project_category_idx
  on public.project_documents(project_id, category, created_at desc);

alter table public.project_documents enable row level security;
revoke all on table public.project_documents from anon, authenticated;

drop trigger if exists set_project_documents_updated_at on public.project_documents;
create trigger set_project_documents_updated_at before update on public.project_documents
for each row execute function public.set_updated_at();
