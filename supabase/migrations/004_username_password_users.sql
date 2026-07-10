-- WebForge.Ai V4 username/password authentication.
-- Sensitive passwords are never stored directly.

create table if not exists user_accounts (
  id uuid primary key default gen_random_uuid(),

  username text not null
    check (
      char_length(username) between 3 and 40
      and username ~ '^[A-Za-z0-9._-]+$'
    ),

  -- Existing project tables currently use an email-shaped identity.
  -- This value is internal and never displayed to the customer.
  internal_email text unique not null,

  password_salt text not null,
  password_hash text not null,

  password_iterations integer not null default 120000
    check (password_iterations between 60000 and 500000),

  status text not null default 'active'
    check (status in ('active', 'suspended', 'disabled')),

  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_user_accounts_username_lower
  on user_accounts (lower(username));

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references user_accounts(id)
    on delete cascade,

  username text not null,
  internal_email text not null,

  token_hash text unique not null,

  installation_id text,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_sessions_active
  on user_sessions(token_hash)
  where revoked_at is null;

create index if not exists idx_user_sessions_user
  on user_sessions(user_id);

create index if not exists idx_user_sessions_expiry
  on user_sessions(expires_at);

create table if not exists user_login_attempts (
  key_hash text primary key,

  attempts integer not null default 0
    check (attempts >= 0),

  first_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_login_attempts_locked
  on user_login_attempts(locked_until);

alter table user_accounts enable row level security;
alter table user_sessions enable row level security;
alter table user_login_attempts enable row level security;

-- These tables are accessed only by the Cloudflare Worker
-- through the Supabase service-role key.
