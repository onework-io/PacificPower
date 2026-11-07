create table if not exists public.notification_read_states (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  notification_key text not null,
  read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, notification_key),
  constraint notification_read_states_key_length check (char_length(notification_key) between 1 and 240)
);

create index if not exists notification_read_states_user_updated_idx
  on public.notification_read_states (organization_id, user_id, updated_at desc);

alter table public.notification_read_states enable row level security;

comment on table public.notification_read_states is
  'Per-user read state for deterministic engineering action-center notification keys.';
