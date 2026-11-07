-- PacificPower private file buckets in Supabase Storage.
-- Object metadata remains in public.files; binaries remain outside PostgreSQL.

begin;

insert into storage.buckets (id, name, public)
values
  ('models', 'models', false),
  ('site-photos', 'site-photos', false),
  ('project-images', 'project-images', false),
  ('imports', 'imports', false)
on conflict (id) do update
set name = excluded.name,
    public = false;

commit;
