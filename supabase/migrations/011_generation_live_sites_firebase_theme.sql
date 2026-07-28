-- Nexora.Ai production generation lifecycle, appearance, live sites and
-- provider-neutral backend provisioning.

alter table public.generation_jobs
  add column if not exists failed_stage text,
  add column if not exists retryable boolean not null default false,
  add column if not exists resume_from_stage text,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists token_reservation_id uuid,
  add column if not exists generation_cost integer,
  add column if not exists terminal_reason_code text;

create index if not exists idx_generation_jobs_watchdog
  on public.generation_jobs(status, updated_at)
  where status in ('queued', 'running');

create table if not exists public.user_preferences (
  owner_email text primary key,
  appearance_mode text not null default 'system'
    check (appearance_mode in ('system', 'light', 'dark')),
  accent_preset text not null default 'nexora-cyan'
    check (accent_preset in (
      'nexora-cyan', 'violet', 'blue', 'emerald', 'rose', 'gold', 'custom'
    )),
  custom_accent text
    check (custom_accent is null or custom_accent ~ '^#[0-9A-Fa-f]{6}$'),
  website_palette jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.published_sites (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'deploying', 'live', 'failed', 'unpublished', 'deleted'
    )),
  hosting_provider text not null,
  live_url text,
  github_repository text,
  thumbnail_url text,
  published_at timestamptz,
  last_deployment_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_email, project_id)
);

create table if not exists public.site_deployments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.published_sites(id) on delete cascade,
  owner_email text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null,
  provider_project_id text,
  provider_deployment_id text,
  status text not null default 'queued'
    check (status in (
      'queued', 'building', 'ready', 'failed', 'cancelled', 'deleted'
    )),
  live_url text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.deployment_events (
  id bigint generated always as identity primary key,
  deployment_id uuid not null
    references public.site_deployments(id) on delete cascade,
  site_id uuid not null
    references public.published_sites(id) on delete cascade,
  owner_email text not null,
  event_type text not null,
  status text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.backend_connections (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  provider text not null,
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'revoked', 'error')),
  external_account_id text,
  external_account_name text,
  granted_scopes text[] not null default '{}',
  token_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_email, provider)
);

create table if not exists public.encrypted_provider_credentials (
  connection_id uuid primary key
    references public.backend_connections(id) on delete cascade,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  encryption_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_backend_configs (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text,
  connection_id uuid references public.backend_connections(id) on delete set null,
  mode text not null
    check (mode in ('none', 'nexora_managed', 'firebase')),
  status text not null default 'draft'
    check (status in (
      'draft', 'awaiting_confirmation', 'provisioning', 'partial',
      'verified', 'failed', 'disconnected'
    )),
  isolation_mode text
    check (isolation_mode in ('separate_project', 'named_database', 'namespaced')),
  external_project_id text,
  external_database_id text,
  namespace text,
  region text,
  backend_plan jsonb not null default '{}'::jsonb,
  safe_public_config jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  verification_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_email, project_id)
);

create table if not exists public.backend_resource_operations (
  id uuid primary key default gen_random_uuid(),
  backend_config_id uuid not null
    references public.website_backend_configs(id) on delete cascade,
  owner_email text not null,
  operation_type text not null,
  resource_type text not null,
  resource_name text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'running', 'completed', 'failed', 'rolled_back',
      'rollback_failed', 'skipped'
    )),
  provider_operation_id text,
  request_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.backend_deployments (
  id uuid primary key default gen_random_uuid(),
  backend_config_id uuid not null
    references public.website_backend_configs(id) on delete cascade,
  owner_email text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'provisioning', 'verifying', 'verified', 'partial',
      'failed', 'rolled_back'
    )),
  region text,
  verification_read_path text,
  verification_write_path text,
  error_message text,
  started_at timestamptz,
  verified_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.managed_backend_access (
  backend_config_id uuid primary key
    references public.website_backend_configs(id) on delete cascade,
  public_key_hash text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table if not exists public.managed_backend_records (
  backend_config_id uuid not null
    references public.website_backend_configs(id) on delete cascade,
  collection_name text not null,
  document_id uuid not null default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (backend_config_id, collection_name, document_id)
);

alter table public.user_preferences enable row level security;
alter table public.published_sites enable row level security;
alter table public.site_deployments enable row level security;
alter table public.deployment_events enable row level security;
alter table public.backend_connections enable row level security;
alter table public.encrypted_provider_credentials enable row level security;
alter table public.website_backend_configs enable row level security;
alter table public.backend_resource_operations enable row level security;
alter table public.backend_deployments enable row level security;
alter table public.managed_backend_access enable row level security;
alter table public.managed_backend_records enable row level security;

create index if not exists idx_published_sites_owner_status
  on public.published_sites(owner_email, status, last_deployment_at desc);
create index if not exists idx_site_deployments_owner_created
  on public.site_deployments(owner_email, created_at desc);
create index if not exists idx_site_deployments_provider_id
  on public.site_deployments(provider, provider_deployment_id);
create index if not exists idx_deployment_events_deployment
  on public.deployment_events(deployment_id, created_at asc);
create index if not exists idx_backend_connections_owner
  on public.backend_connections(owner_email, provider);
create index if not exists idx_backend_configs_owner
  on public.website_backend_configs(owner_email, status);
create index if not exists idx_backend_operations_config
  on public.backend_resource_operations(backend_config_id, created_at asc);
create index if not exists idx_managed_backend_records_collection
  on public.managed_backend_records(
    backend_config_id, collection_name, created_at desc
  );

drop trigger if exists user_preferences_set_updated_at
  on public.user_preferences;
create trigger user_preferences_set_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

drop trigger if exists published_sites_set_updated_at
  on public.published_sites;
create trigger published_sites_set_updated_at
before update on public.published_sites
for each row execute function public.set_updated_at();

drop trigger if exists backend_connections_set_updated_at
  on public.backend_connections;
create trigger backend_connections_set_updated_at
before update on public.backend_connections
for each row execute function public.set_updated_at();

drop trigger if exists website_backend_configs_set_updated_at
  on public.website_backend_configs;
create trigger website_backend_configs_set_updated_at
before update on public.website_backend_configs
for each row execute function public.set_updated_at();

drop trigger if exists managed_backend_records_set_updated_at
  on public.managed_backend_records;
create trigger managed_backend_records_set_updated_at
before update on public.managed_backend_records
for each row execute function public.set_updated_at();

-- OAuth states must support backend providers as well as publishing providers.
alter table public.oauth_states
  drop constraint if exists oauth_states_provider_check;
alter table public.oauth_states
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.oauth_states
  add constraint oauth_states_provider_check
  check (provider in ('github', 'vercel', 'firebase'));

-- These tables are accessed only by the authenticated Worker through the
-- service-role key. No anon/authenticated policies are intentionally added.
