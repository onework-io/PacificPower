create table if not exists public.notification_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  enabled_types jsonb not null default '["daily", "labor", "dispatch", "qualification"]'::jsonb,
  minimum_severity text not null default 'warning',
  realtime_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint notification_preferences_severity_check check (minimum_severity in ('info', 'warning', 'critical')),
  constraint notification_preferences_types_array_check check (jsonb_typeof(enabled_types) = 'array')
);

alter table public.notification_preferences enable row level security;

comment on table public.notification_preferences is
  'Per-user action-center category, severity and realtime delivery preferences.';
