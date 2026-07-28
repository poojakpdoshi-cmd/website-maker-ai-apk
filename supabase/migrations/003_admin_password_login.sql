-- Nexora.Ai V2.1: secure username/password admin sessions.

create table if not exists admin_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  username text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists admin_login_attempts (
  ip_hash text primary key,
  attempts integer not null default 0 check (attempts >= 0),
  first_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table admin_sessions enable row level security;
alter table admin_login_attempts enable row level security;

create index if not exists idx_admin_sessions_expiry on admin_sessions(expires_at);
create index if not exists idx_admin_sessions_active on admin_sessions(token_hash) where revoked_at is null;
create index if not exists idx_admin_login_attempts_locked on admin_login_attempts(locked_until);

-- The Cloudflare Worker accesses these tables using the Supabase service-role key.
-- Do not expose the service-role key in the APK or browser applications.
