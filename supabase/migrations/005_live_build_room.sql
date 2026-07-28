-- Nexora.Ai V5: real multi-agent activity and Live Build Room.

alter table generation_jobs
  add column if not exists progress integer not null default 0
    check (progress between 0 and 100);

alter table generation_jobs
  add column if not exists current_agent text;

alter table generation_jobs
  add column if not exists workflow_mode text not null default 'auto';

alter table generation_jobs
  add column if not exists agent_states jsonb not null default '[]'::jsonb;

alter table generation_jobs
  add column if not exists started_at timestamptz;

alter table generation_jobs
  add column if not exists updated_at timestamptz not null default now();

alter table generation_jobs
  add column if not exists cancelled_at timestamptz;

create table if not exists generation_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null
    references generation_jobs(id) on delete cascade,
  email text not null,
  event_type text not null,
  agent_name text,
  status text not null default 'info',
  title text not null,
  detail text,
  progress integer check (progress between 0 and 100),
  file_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table generation_job_events enable row level security;

create index if not exists idx_job_events_job_created
  on generation_job_events(job_id, created_at asc);

create index if not exists idx_job_events_email_created
  on generation_job_events(email, created_at desc);

create index if not exists idx_generation_jobs_status_updated
  on generation_jobs(status, updated_at desc);

drop trigger if exists generation_jobs_set_updated_at
  on generation_jobs;

create trigger generation_jobs_set_updated_at
before update on generation_jobs
for each row execute function set_updated_at();
