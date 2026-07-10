-- Website Maker AI V2: real multi-file projects, OAuth states and deployments.

alter table projects add column if not exists framework text not null default 'vite-react';
alter table projects add column if not exists vercel_deployment_id text;
alter table projects add column if not exists deployment_state text;

alter table project_versions add column if not exists generated_files jsonb not null default '[]'::jsonb;
alter table project_versions add column if not exists preview_html text;

alter table provider_connections add column if not exists external_account_name text;
alter table provider_connections add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists oauth_states (
  state uuid primary key,
  email text not null,
  provider text not null check (provider in ('github','vercel')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table oauth_states enable row level security;

create index if not exists idx_oauth_states_expiry on oauth_states(expires_at);
create index if not exists idx_provider_connections_email on provider_connections(email);
create index if not exists idx_projects_deployment_state on projects(deployment_state);

-- The Cloudflare Worker uses the Supabase service-role key and therefore bypasses RLS.
-- Never put the service-role key inside the APK, admin browser bundle, or generated websites.
