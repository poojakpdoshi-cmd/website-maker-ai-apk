-- Replace recurring cycle resets with non-expiring token packages.
-- Legacy cycle/monthly columns remain for compatibility but are no longer
-- authoritative and are not used to reset, expire or refill balances.

alter table public.subscription_plans
  add column if not exists package_price_inr numeric(10,2)
    check (package_price_inr is null or package_price_inr >= 0),
  add column if not exists package_tokens integer
    check (package_tokens is null or package_tokens >= 0),
  add column if not exists package_active boolean not null default true;

update public.subscription_plans set
  package_price_inr = coalesce(package_price_inr, monthly_price_inr),
  package_tokens = coalesce(package_tokens, monthly_tokens),
  recurring = false,
  package_active = id in ('starter', 'pro', 'business'),
  active = id in ('starter', 'pro', 'business'),
  updated_at = now();

create table if not exists public.token_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.user_accounts(id) on delete cascade,
  transaction_type text not null check (
    transaction_type in (
      'package_grant',
      'qa_usage',
      'website_generation_usage',
      'other_usage',
      'internal_failure_refund',
      'admin_bonus'
    )
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  amount integer not null check (amount <> 0 and amount between -1000000000 and 1000000000),
  balance_after bigint not null check (balance_after between 0 and 2147483647),
  operation text not null,
  reference_id text,
  reason text not null check (char_length(reason) between 1 and 500),
  actor_id text,
  target_account_id uuid not null references public.user_accounts(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique (account_id, idempotency_key)
);

create index if not exists idx_token_transactions_account_created
  on public.token_transactions(account_id, created_at desc, id desc);
create index if not exists idx_token_transactions_target_created
  on public.token_transactions(target_account_id, created_at desc);

alter table public.token_transactions enable row level security;
alter table public.token_transactions force row level security;

create or replace function public.nexora_token_transactions_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'NEXORA_TOKEN_LEDGER_IMMUTABLE';
end;
$$;

drop trigger if exists token_transactions_no_update on public.token_transactions;
create trigger token_transactions_no_update
before update on public.token_transactions
for each row execute function public.nexora_token_transactions_immutable();

-- Direct transaction deletion is inaccessible under forced RLS. Cascading
-- deletion remains possible only when an administrator erases the owning
-- account under the existing privacy workflow.

-- Establish an opening immutable entry from the valid balance present when this
-- compatibility migration is applied. It does not invent or duplicate tokens.
insert into public.token_transactions (
  account_id, transaction_type, idempotency_key, amount, balance_after,
  operation, reason, actor_id, target_account_id, metadata
)
select
  wallet.account_id,
  'package_grant',
  'migration-013-opening-balance:' || wallet.account_id::text,
  wallet.monthly_balance + wallet.topup_balance,
  wallet.monthly_balance + wallet.topup_balance,
  'opening_balance',
  'Opening balance preserved by non-expiring package migration',
  'migration:013',
  wallet.account_id,
  jsonb_build_object('source', 'legacy_wallet')
from public.token_wallets wallet
where wallet.monthly_balance + wallet.topup_balance > 0
on conflict (account_id, idempotency_key) do nothing;

-- Consolidate old balance buckets without changing the total.
update public.token_wallets set
  topup_balance = monthly_balance + topup_balance,
  monthly_balance = 0,
  reset_at = null,
  updated_at = now()
where monthly_balance <> 0 or reset_at is not null;

update public.user_subscriptions set
  status = 'active',
  renews_at = null,
  cancelled_at = null,
  updated_at = now();

update public.approved_users au set
  status = 'active',
  expires_at = null
from public.user_accounts account
where au.email = lower(account.internal_email);

create or replace function public.nexora_initialize_billing(
  p_account_id uuid,
  p_plan_id text default 'trial'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.user_accounts where id = p_account_id
  ) then
    raise exception 'NEXORA_ACCOUNT_NOT_FOUND';
  end if;

  insert into public.user_subscriptions (
    account_id, plan_id, status, cycle_start, cycle_end, renews_at
  ) values (
    p_account_id,
    case when exists (
      select 1 from public.subscription_plans where id = p_plan_id
    ) then p_plan_id else 'trial' end,
    'active',
    now(),
    now(),
    null
  ) on conflict (account_id) do nothing;

  insert into public.token_wallets (
    account_id, monthly_balance, topup_balance, reserved_balance,
    lifetime_used, reset_at
  ) values (
    p_account_id, 0, 0, 0, 0, null
  ) on conflict (account_id) do nothing;
end;
$$;

create or replace function public.nexora_wallet_snapshot(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.user_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_wallet public.token_wallets%rowtype;
begin
  perform public.nexora_initialize_billing(p_account_id, 'trial');

  select * into v_sub from public.user_subscriptions
  where account_id = p_account_id;
  select * into v_plan from public.subscription_plans
  where id = v_sub.plan_id;
  select * into v_wallet from public.token_wallets
  where account_id = p_account_id;

  return jsonb_build_object(
    'accountId', p_account_id,
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'name', v_plan.name,
      'packagePriceInr', v_plan.package_price_inr,
      'packageTokens', v_plan.package_tokens,
      'nonExpiring', true
    ),
    'entitlement', jsonb_build_object('status', v_sub.status),
    'wallet', jsonb_build_object(
      'available', v_wallet.monthly_balance + v_wallet.topup_balance,
      'reservedBalance', v_wallet.reserved_balance,
      'lifetimeUsed', v_wallet.lifetime_used,
      'nonExpiring', true
    )
  );
end;
$$;

create unique index if not exists idx_token_ledger_operation_reference_unique
  on public.token_ledger(account_id, operation, reference_id)
  where reference_id is not null;

create or replace function public.nexora_reserve_tokens(
  p_account_id uuid,
  p_amount integer,
  p_operation text,
  p_reference_id text default null,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.token_wallets%rowtype;
  v_existing public.token_ledger%rowtype;
  v_from_monthly integer;
  v_from_topup integer;
  v_available integer;
  v_reservation_id uuid;
  v_transaction_type text;
  v_idempotency_key text;
begin
  if p_amount <= 0 or p_amount > 1000000000 or
     char_length(coalesce(p_operation, '')) not between 1 and 100 or
     p_reference_id is null or char_length(p_reference_id) not between 8 and 160 then
    raise exception 'NEXORA_INVALID_TOKEN_RESERVATION';
  end if;

  perform public.nexora_initialize_billing(p_account_id, 'trial');
  perform pg_advisory_xact_lock(
    hashtextextended(p_account_id::text || ':' || p_operation || ':' || p_reference_id, 0)
  );

  select * into v_existing from public.token_ledger
  where account_id = p_account_id
    and operation = p_operation
    and reference_id = p_reference_id
  limit 1;
  if found then
    return jsonb_build_object(
      'reservationId', v_existing.id,
      'amount', v_existing.amount,
      'available', v_existing.balance_after,
      'existing', true
    );
  end if;

  select * into v_wallet from public.token_wallets
  where account_id = p_account_id for update;
  v_available := v_wallet.monthly_balance + v_wallet.topup_balance;
  if v_available < p_amount then
    raise exception 'NEXORA_INSUFFICIENT_TOKENS:%:%', v_available, p_amount;
  end if;

  v_from_monthly := least(v_wallet.monthly_balance, p_amount);
  v_from_topup := p_amount - v_from_monthly;
  update public.token_wallets set
    monthly_balance = monthly_balance - v_from_monthly,
    topup_balance = topup_balance - v_from_topup,
    reserved_balance = reserved_balance + p_amount,
    updated_at = now()
  where account_id = p_account_id returning * into v_wallet;

  insert into public.token_ledger (
    account_id, operation, reference_id, description, amount, direction,
    status, monthly_amount, topup_amount, balance_after, metadata
  ) values (
    p_account_id, p_operation, p_reference_id, left(coalesce(p_description, ''), 500),
    p_amount, 'reserve', 'reserved', v_from_monthly, v_from_topup,
    v_wallet.monthly_balance + v_wallet.topup_balance,
    jsonb_build_object('reservedAt', clock_timestamp())
  ) returning id into v_reservation_id;

  v_transaction_type := case
    when p_operation = 'assistant_chat' then 'qa_usage'
    when p_operation = 'website_generation' then 'website_generation_usage'
    else 'other_usage'
  end;
  v_idempotency_key := 'usage:' || p_operation || ':' || p_reference_id;

  insert into public.token_transactions (
    account_id, transaction_type, idempotency_key, amount, balance_after,
    operation, reference_id, reason, actor_id, target_account_id, metadata
  ) values (
    p_account_id, v_transaction_type, v_idempotency_key, -p_amount,
    v_wallet.monthly_balance + v_wallet.topup_balance, p_operation,
    v_reservation_id::text, left(coalesce(nullif(p_description, ''), p_operation), 500),
    'system', p_account_id, jsonb_build_object('reservationId', v_reservation_id)
  );

  return jsonb_build_object(
    'reservationId', v_reservation_id,
    'amount', p_amount,
    'available', v_wallet.monthly_balance + v_wallet.topup_balance,
    'existing', false
  );
end;
$$;

create or replace function public.nexora_refund_tokens(
  p_reservation_id uuid,
  p_reason text default 'Operation failed'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.token_ledger%rowtype;
  v_wallet public.token_wallets%rowtype;
begin
  select * into v_entry from public.token_ledger
  where id = p_reservation_id for update;
  if not found then raise exception 'NEXORA_RESERVATION_NOT_FOUND'; end if;
  if v_entry.status = 'refunded' then
    return public.nexora_wallet_snapshot(v_entry.account_id);
  end if;
  if v_entry.status <> 'reserved' then
    return public.nexora_wallet_snapshot(v_entry.account_id);
  end if;

  update public.token_wallets set
    monthly_balance = monthly_balance + v_entry.monthly_amount,
    topup_balance = topup_balance + v_entry.topup_amount,
    reserved_balance = greatest(0, reserved_balance - v_entry.amount),
    updated_at = now()
  where account_id = v_entry.account_id returning * into v_wallet;

  update public.token_ledger set
    direction = 'refund',
    status = 'refunded',
    completed_at = now(),
    balance_after = v_wallet.monthly_balance + v_wallet.topup_balance,
    metadata = metadata || jsonb_build_object(
      'refundedAt', clock_timestamp(),
      'reason', left(coalesce(p_reason, 'Operation failed'), 500)
    )
  where id = p_reservation_id;

  insert into public.token_transactions (
    account_id, transaction_type, idempotency_key, amount, balance_after,
    operation, reference_id, reason, actor_id, target_account_id, metadata
  ) values (
    v_entry.account_id, 'internal_failure_refund',
    'internal-failure-refund:' || p_reservation_id::text,
    v_entry.amount, v_wallet.monthly_balance + v_wallet.topup_balance,
    v_entry.operation, p_reservation_id::text,
    left(coalesce(p_reason, 'Operation failed'), 500),
    'system', v_entry.account_id, jsonb_build_object('reservationId', p_reservation_id)
  ) on conflict (account_id, idempotency_key) do nothing;

  return public.nexora_wallet_snapshot(v_entry.account_id);
end;
$$;

create or replace function public.nexora_grant_token_package(
  p_account_id uuid,
  p_plan_id text,
  p_idempotency_key text,
  p_actor_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_wallet public.token_wallets%rowtype;
  v_existing public.token_transactions%rowtype;
begin
  if p_plan_id not in ('starter', 'pro', 'business') or
     char_length(coalesce(p_idempotency_key, '')) not between 8 and 160 or
     char_length(trim(coalesce(p_actor_id, ''))) not between 1 and 160 or
     char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'NEXORA_INVALID_PACKAGE_GRANT';
  end if;

  select * into v_plan from public.subscription_plans
  where id = p_plan_id and package_active = true and package_tokens is not null;
  if not found then raise exception 'NEXORA_PLAN_NOT_CONFIGURED'; end if;
  if v_plan.package_tokens <= 0 then raise exception 'NEXORA_PLAN_NOT_CONFIGURED'; end if;

  perform public.nexora_initialize_billing(p_account_id, p_plan_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_account_id::text || ':package:' || p_idempotency_key, 0)
  );
  select * into v_existing from public.token_transactions
  where account_id = p_account_id and idempotency_key = p_idempotency_key;
  if found then return public.nexora_wallet_snapshot(p_account_id); end if;

  select * into v_wallet from public.token_wallets
  where account_id = p_account_id for update;
  if v_wallet.topup_balance::bigint + v_plan.package_tokens > 2147483647 then
    raise exception 'NEXORA_TOKEN_OVERFLOW';
  end if;

  update public.token_wallets set
    topup_balance = topup_balance + v_plan.package_tokens,
    updated_at = now()
  where account_id = p_account_id returning * into v_wallet;
  update public.user_subscriptions set
    plan_id = p_plan_id, status = 'active', renews_at = null,
    cancelled_at = null, updated_at = now()
  where account_id = p_account_id;

  insert into public.token_transactions (
    account_id, transaction_type, idempotency_key, amount, balance_after,
    operation, reference_id, reason, actor_id, target_account_id, metadata
  ) values (
    p_account_id, 'package_grant', p_idempotency_key, v_plan.package_tokens,
    v_wallet.monthly_balance + v_wallet.topup_balance, 'package_grant',
    p_plan_id, trim(p_reason), trim(p_actor_id), p_account_id,
    jsonb_build_object('planId', p_plan_id)
  );

  update public.approved_users au set status = 'active', expires_at = null
  from public.user_accounts account
  where account.id = p_account_id and au.email = lower(account.internal_email);
  return public.nexora_wallet_snapshot(p_account_id);
end;
$$;

create or replace function public.nexora_grant_admin_bonus(
  p_account_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_actor_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.token_wallets%rowtype;
  v_existing public.token_transactions%rowtype;
begin
  if p_amount <= 0 or p_amount > 1000000000 or
     char_length(coalesce(p_idempotency_key, '')) not between 8 and 160 or
     char_length(trim(coalesce(p_actor_id, ''))) not between 1 and 160 or
     char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'NEXORA_INVALID_ADMIN_BONUS';
  end if;

  perform public.nexora_initialize_billing(p_account_id, 'trial');
  perform pg_advisory_xact_lock(
    hashtextextended(p_account_id::text || ':bonus:' || p_idempotency_key, 0)
  );
  select * into v_existing from public.token_transactions
  where account_id = p_account_id and idempotency_key = p_idempotency_key;
  if found then return public.nexora_wallet_snapshot(p_account_id); end if;

  select * into v_wallet from public.token_wallets
  where account_id = p_account_id for update;
  if v_wallet.topup_balance::bigint + p_amount > 2147483647 then
    raise exception 'NEXORA_TOKEN_OVERFLOW';
  end if;
  update public.token_wallets set
    topup_balance = topup_balance + p_amount, updated_at = now()
  where account_id = p_account_id returning * into v_wallet;

  insert into public.token_transactions (
    account_id, transaction_type, idempotency_key, amount, balance_after,
    operation, reason, actor_id, target_account_id, metadata
  ) values (
    p_account_id, 'admin_bonus', p_idempotency_key, p_amount,
    v_wallet.monthly_balance + v_wallet.topup_balance, 'admin_bonus',
    trim(p_reason), trim(p_actor_id), p_account_id, '{}'::jsonb
  );
  return public.nexora_wallet_snapshot(p_account_id);
end;
$$;

-- The destructive legacy API is deliberately disabled. Call one of the
-- idempotent grant functions above.
create or replace function public.nexora_admin_set_billing(
  p_account_id uuid,
  p_plan_id text,
  p_status text,
  p_cycle_end timestamptz,
  p_token_adjustment integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'NEXORA_LEGACY_BILLING_DISABLED';
end;
$$;

revoke all on table public.token_transactions from public, anon, authenticated;
revoke all on function public.nexora_grant_token_package(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.nexora_grant_admin_bonus(uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.nexora_grant_token_package(uuid, text, text, text, text)
  to service_role;
grant execute on function public.nexora_grant_admin_bonus(uuid, integer, text, text, text)
  to service_role;
