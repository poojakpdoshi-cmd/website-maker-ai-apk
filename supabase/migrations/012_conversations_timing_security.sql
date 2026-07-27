-- Durable, owner-scoped conversations plus authoritative timing/rate controls.
-- Deletion is soft: deleted rows are hidden from users but retained for recovery,
-- abuse investigation and idempotent offline synchronization.

create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id uuid primary key,
  account_id uuid not null references public.user_accounts(id) on delete cascade,
  title text not null default 'New chat' check (char_length(title) between 1 and 120),
  conversation_type text not null default 'qa'
    check (conversation_type in ('qa', 'generation', 'mixed')),
  linked_project_id uuid references public.projects(id) on delete set null,
  linked_generation_id uuid references public.generation_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, account_id)
);

create index if not exists idx_conversations_account_recent
  on public.conversations(account_id, last_message_at desc, id desc)
  where deleted_at is null;

create table if not exists public.conversation_messages (
  id uuid primary key,
  conversation_id uuid not null,
  account_id uuid not null references public.user_accounts(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (char_length(content) <= 30000),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'cancelled')),
  provider text,
  model text,
  finish_reason text,
  error_category text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  started_at timestamptz,
  first_token_at timestamptz,
  completed_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, idempotency_key),
  foreign key (conversation_id, account_id)
    references public.conversations(id, account_id) on delete cascade
);

create index if not exists idx_conversation_messages_page
  on public.conversation_messages(conversation_id, created_at desc, id desc);

create table if not exists public.api_rate_limits (
  account_id uuid not null references public.user_accounts(id) on delete cascade,
  scope text not null check (char_length(scope) between 1 and 80),
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, scope)
);

alter table public.conversations enable row level security;
alter table public.conversations force row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_messages force row level security;
alter table public.api_rate_limits enable row level security;
alter table public.api_rate_limits force row level security;

-- Username/password sessions are verified by the Worker and are intentionally
-- not Supabase client sessions. No anon/authenticated policies are created:
-- only the service-role Worker can access private conversation rows.

create or replace function public.nexora_check_rate_limit(
  p_account_id uuid,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.api_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_limit < 1 or p_limit > 10000 or
     p_window_seconds < 1 or p_window_seconds > 86400 or
     char_length(coalesce(p_scope, '')) not between 1 and 80 then
    raise exception 'NEXORA_INVALID_RATE_LIMIT';
  end if;

  insert into public.api_rate_limits (
    account_id, scope, window_started_at, request_count, updated_at
  ) values (
    p_account_id, p_scope, v_now, 1, v_now
  )
  on conflict (account_id, scope) do update set
    window_started_at = case
      when public.api_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
      then v_now else public.api_rate_limits.window_started_at end,
    request_count = case
      when public.api_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
      then 1 else public.api_rate_limits.request_count + 1 end,
    updated_at = v_now
  returning * into v_row;

  return jsonb_build_object(
    'allowed', v_row.request_count <= p_limit,
    'remaining', greatest(0, p_limit - v_row.request_count),
    'retryAfterSeconds', greatest(
      1,
      p_window_seconds -
        extract(epoch from (v_now - v_row.window_started_at))::integer
    )
  );
end;
$$;

create or replace function public.nexora_begin_conversation_turn(
  p_account_id uuid,
  p_conversation_id uuid,
  p_user_message_id uuid,
  p_assistant_message_id uuid,
  p_idempotency_key text,
  p_title text,
  p_content text,
  p_conversation_type text default 'qa',
  p_linked_project_id uuid default null,
  p_linked_generation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations%rowtype;
  v_existing public.conversation_messages%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 150 or
     char_length(coalesce(p_content, '')) not between 1 and 30000 or
     p_conversation_type not in ('qa', 'generation', 'mixed') then
    raise exception 'NEXORA_INVALID_CONVERSATION_TURN';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_account_id::text || ':' || p_idempotency_key, 0)
  );

  select * into v_existing
  from public.conversation_messages
  where account_id = p_account_id
    and idempotency_key = p_idempotency_key || ':assistant'
  limit 1;

  if found then
    return jsonb_build_object(
      'existing', true,
      'assistantMessageId', v_existing.id,
      'status', v_existing.status,
      'content', v_existing.content,
      'provider', v_existing.provider,
      'model', v_existing.model,
      'finishReason', v_existing.finish_reason,
      'errorCategory', v_existing.error_category,
      'durationMs', v_existing.duration_ms,
      'inputTokens', v_existing.input_tokens,
      'outputTokens', v_existing.output_tokens,
      'totalTokens', v_existing.total_tokens
    );
  end if;

  insert into public.conversations (
    id, account_id, title, conversation_type, linked_project_id,
    linked_generation_id, created_at, updated_at, last_message_at
  ) values (
    p_conversation_id,
    p_account_id,
    left(coalesce(nullif(trim(p_title), ''), 'New chat'), 120),
    p_conversation_type,
    p_linked_project_id,
    p_linked_generation_id,
    v_now,
    v_now,
    v_now
  ) on conflict (id) do nothing;

  select * into v_conversation
  from public.conversations
  where id = p_conversation_id
  for update;

  if not found or v_conversation.account_id <> p_account_id or
     v_conversation.deleted_at is not null then
    raise exception 'NEXORA_CONVERSATION_NOT_FOUND';
  end if;

  insert into public.conversation_messages (
    id, conversation_id, account_id, idempotency_key, role, content,
    status, started_at, created_at, updated_at
  ) values (
    p_user_message_id, p_conversation_id, p_account_id,
    p_idempotency_key || ':user', 'user', p_content,
    'completed', v_now, v_now, v_now
  );

  insert into public.conversation_messages (
    id, conversation_id, account_id, idempotency_key, role, content,
    status, started_at, created_at, updated_at
  ) values (
    p_assistant_message_id, p_conversation_id, p_account_id,
    p_idempotency_key || ':assistant', 'assistant', '',
    'pending', v_now, v_now, v_now
  );

  update public.conversations set
    updated_at = v_now,
    last_message_at = v_now
  where id = p_conversation_id;

  return jsonb_build_object(
    'existing', false,
    'assistantMessageId', p_assistant_message_id,
    'status', 'pending'
  );
end;
$$;

create or replace function public.nexora_complete_conversation_turn(
  p_account_id uuid,
  p_assistant_message_id uuid,
  p_content text,
  p_provider text,
  p_model text,
  p_finish_reason text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_duration_ms bigint,
  p_first_token_ms bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.conversation_messages%rowtype;
  v_completed_at timestamptz := clock_timestamp();
begin
  if char_length(coalesce(p_content, '')) not between 1 and 30000 or
     p_duration_ms < 0 then
    raise exception 'NEXORA_INVALID_CONVERSATION_COMPLETION';
  end if;

  select * into v_message from public.conversation_messages
  where id = p_assistant_message_id and account_id = p_account_id
  for update;
  if not found then raise exception 'NEXORA_MESSAGE_NOT_FOUND'; end if;
  if v_message.status = 'completed' then return; end if;
  if v_message.status <> 'pending' then
    raise exception 'NEXORA_MESSAGE_NOT_PENDING';
  end if;

  update public.conversation_messages set
    content = p_content,
    status = 'completed',
    provider = left(p_provider, 80),
    model = left(p_model, 160),
    finish_reason = left(p_finish_reason, 80),
    input_tokens = p_input_tokens,
    output_tokens = p_output_tokens,
    total_tokens = p_total_tokens,
    first_token_at = case when p_first_token_ms is null then null
      else started_at + make_interval(secs => p_first_token_ms::double precision / 1000) end,
    completed_at = v_completed_at,
    duration_ms = p_duration_ms,
    updated_at = v_completed_at
  where id = p_assistant_message_id;

  update public.conversations set
    updated_at = v_completed_at,
    last_message_at = v_completed_at
  where id = v_message.conversation_id;
end;
$$;

create or replace function public.nexora_fail_conversation_turn(
  p_account_id uuid,
  p_assistant_message_id uuid,
  p_error_category text,
  p_duration_ms bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.conversation_messages%rowtype;
  v_completed_at timestamptz := clock_timestamp();
begin
  select * into v_message from public.conversation_messages
  where id = p_assistant_message_id and account_id = p_account_id
  for update;
  if not found then raise exception 'NEXORA_MESSAGE_NOT_FOUND'; end if;
  if v_message.status in ('failed', 'cancelled', 'completed') then return; end if;

  update public.conversation_messages set
    content = case
      when content = '' then 'The Q&A request failed.'
      else content
    end,
    status = 'failed',
    error_category = left(coalesce(p_error_category, 'internal'), 80),
    completed_at = v_completed_at,
    duration_ms = greatest(0, p_duration_ms),
    updated_at = v_completed_at
  where id = p_assistant_message_id;

  update public.conversations set
    updated_at = v_completed_at,
    last_message_at = v_completed_at
  where id = v_message.conversation_id;
end;
$$;

-- Existing lifecycle writes already set started_at and completed_at. This
-- trigger derives durable elapsed time from those authoritative timestamps.
alter table public.generation_jobs
  add column if not exists duration_ms bigint
  check (duration_ms is null or duration_ms >= 0);

create or replace function public.nexora_generation_duration_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.started_at is not null and new.completed_at is not null then
    new.duration_ms := greatest(
      0,
      floor(extract(epoch from (new.completed_at - new.started_at)) * 1000)::bigint
    );
  elsif new.completed_at is null then
    new.duration_ms := null;
  end if;
  return new;
end;
$$;

drop trigger if exists generation_jobs_set_duration on public.generation_jobs;
create trigger generation_jobs_set_duration
before insert or update of started_at, completed_at on public.generation_jobs
for each row execute function public.nexora_generation_duration_trigger();

update public.generation_jobs
set duration_ms = greatest(
  0,
  floor(extract(epoch from (completed_at - started_at)) * 1000)::bigint
)
where started_at is not null and completed_at is not null;

revoke all on function public.nexora_check_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.nexora_begin_conversation_turn(uuid, uuid, uuid, uuid, text, text, text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.nexora_complete_conversation_turn(uuid, uuid, text, text, text, text, integer, integer, integer, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.nexora_fail_conversation_turn(uuid, uuid, text, bigint)
  from public, anon, authenticated;

grant execute on function public.nexora_check_rate_limit(uuid, text, integer, integer)
  to service_role;
grant execute on function public.nexora_begin_conversation_turn(uuid, uuid, uuid, uuid, text, text, text, text, uuid, uuid)
  to service_role;
grant execute on function public.nexora_complete_conversation_turn(uuid, uuid, text, text, text, text, integer, integer, integer, bigint, bigint)
  to service_role;
grant execute on function public.nexora_fail_conversation_turn(uuid, uuid, text, bigint)
  to service_role;
