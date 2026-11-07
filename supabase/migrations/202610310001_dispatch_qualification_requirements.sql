-- Required skills/certificates for each crew dispatch.

begin;

alter table public.crew_dispatches
  add column if not exists required_qualifications jsonb not null default '[]'::jsonb;

alter table public.crew_dispatches
  drop constraint if exists crew_dispatches_required_qualifications_array;
alter table public.crew_dispatches
  add constraint crew_dispatches_required_qualifications_array
  check (jsonb_typeof(required_qualifications) = 'array');

commit;
