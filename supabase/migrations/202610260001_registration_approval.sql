-- Capture Supabase Auth sign-ups for explicit PacificPower administrator approval.

begin;

create table if not exists public.registration_requests (
  id uuid primary key default gen_random_uuid(),
  external_subject text not null unique,
  email text not null,
  display_name text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists registration_requests_email_idx
  on public.registration_requests (lower(email));

create or replace function public.capture_pacificpower_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.registration_requests (external_subject, email, display_name)
  values (
    new.id::text,
    lower(coalesce(new.email, '')),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (external_subject) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_pacificpower_auth_user_created on auth.users;
create trigger on_pacificpower_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.capture_pacificpower_registration();

-- Backfill existing Auth users so the approval queue also covers accounts created before this migration.
insert into public.registration_requests (external_subject, email, display_name)
select
  id::text,
  lower(coalesce(email, '')),
  coalesce(nullif(trim(raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(email, ''), '@', 1))
from auth.users
where email is not null
on conflict (external_subject) do nothing;

alter table public.registration_requests enable row level security;
revoke all on table public.registration_requests from anon, authenticated;

drop trigger if exists set_registration_requests_updated_at on public.registration_requests;
create trigger set_registration_requests_updated_at before update on public.registration_requests
for each row execute function public.set_updated_at();

commit;
