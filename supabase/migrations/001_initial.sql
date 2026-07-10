create extension if not exists pgcrypto;

create table if not exists approved_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null check (email = lower(email)),
  status text not null default 'pending' check (status in ('pending','active','blocked','expired')),
  expires_at timestamptz,
  max_devices integer not null default 2 check (max_devices between 1 and 5),
  daily_website_limit integer not null default 1 check (daily_website_limit between 0 and 100),
  daily_edit_limit integer not null default 10 check (daily_edit_limit between 0 and 500),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  email text not null references approved_users(email) on delete cascade,
  installation_id text unique not null,
  device_public_key text,
  device_name text,
  android_version text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists payment_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  amount numeric(10,2),
  transaction_reference text,
  proof_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  description text,
  website_type text,
  status text not null default 'draft',
  plan jsonb not null default '{}'::jsonb,
  github_repository text,
  vercel_project_id text,
  preview_url text,
  production_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version_number integer not null,
  prompt text,
  plan jsonb not null,
  generated_html text,
  created_at timestamptz not null default now(),
  unique(project_id, version_number)
);

create table if not exists generation_jobs (
  id uuid primary key,
  email text not null,
  project_id uuid references projects(id) on delete set null,
  prompt text not null,
  status text not null default 'queued',
  current_step text,
  attempt_count integer not null default 0,
  error_message text,
  output_plan jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists provider_connections (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  provider text not null check (provider in ('github','vercel')),
  external_account_id text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(email, provider)
);

create table if not exists website_forms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  public_key text unique not null default encode(gen_random_bytes(24), 'hex'),
  allowed_domain text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references website_forms(id) on delete cascade,
  payload jsonb not null,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table approved_users enable row level security;
alter table devices enable row level security;
alter table payment_requests enable row level security;
alter table projects enable row level security;
alter table project_versions enable row level security;
alter table generation_jobs enable row level security;
alter table provider_connections enable row level security;
alter table website_forms enable row level security;
alter table form_submissions enable row level security;
alter table audit_logs enable row level security;

-- The service-role backend bypasses RLS. Add user JWT policies after wiring Supabase Auth.
-- Never expose SUPABASE_SERVICE_ROLE_KEY to the APK or browser.


create index if not exists idx_devices_email_active on devices(email) where revoked_at is null;
create index if not exists idx_projects_email_created on projects(email, created_at desc);
create index if not exists idx_generation_jobs_email_created on generation_jobs(email, created_at desc);
create index if not exists idx_project_versions_project on project_versions(project_id, version_number desc);
create index if not exists idx_form_submissions_form_created on form_submissions(form_id, created_at desc);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at before update on projects for each row execute function set_updated_at();

drop trigger if exists provider_connections_set_updated_at on provider_connections;
create trigger provider_connections_set_updated_at before update on provider_connections for each row execute function set_updated_at();
