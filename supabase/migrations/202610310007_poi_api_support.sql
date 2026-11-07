-- Project-scoped POI query support for the NestJS API.

begin;

create index if not exists idx_pois_project_created
  on public.pois (project_id, created_at);

create index if not exists idx_pois_project_model_part
  on public.pois (project_id, model_part_id);

comment on table public.pois is
  'Project-scoped 3D annotations linked to a model version and model part.';

commit;
