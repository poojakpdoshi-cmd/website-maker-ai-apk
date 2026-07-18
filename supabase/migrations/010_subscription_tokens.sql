-- Nexora.Ai monthly subscriptions and server-controlled token wallet.
-- All balances and charges are enforced in PostgreSQL. The APK never owns the balance.

create extension if not exists pgcrypto;

create table if not exists public.subscription_plans (
  id text primary key,
  name text not null,
  monthly_price_inr numeric(10,2) not null default 0 check (monthly_price_inr >= 0),
  monthly_tokens integer not null check (monthly_tokens >= 0),
  recurring boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.subscription_plans (
  id, name, monthly_price_inr, monthly_tokens, recurring, active, sort_order
)
values
  ('trial', 'Free Trial', 0, 100, false, true, 0),
  ('starter', 'Starter', 199, 1000, true, true, 10),
  ('pro', 'Pro', 499, 3500, true, true, 20),
  ('business', 'Business', 999, 9000, true, true, 30)
on conflict (id) do update set
  name = excluded.name,
  monthly_price_inr = excluded.monthly_price_inr,
  monthly_tokens = excluded.monthly_tokens,
  recurring = excluded.recurring,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.token_operation_costs (
  operation text primary key,
  display_name text not null,
  tokens integer not null check (tokens >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.token_operation_costs (operation, display_name, tokens, active)
values
  ('assistant_chat', 'AI chat message', 3, true),
  ('website_generation', 'Complete website generation', 100, true),
  ('image_analysis', 'Image or screenshot analysis', 15, true),
  ('website_edit', 'Website redesign or edit', 60, true),
  ('publish', 'Publish website', 20, true),
  ('export_static', 'Static ZIP export', 5, true),
  ('export_react', 'React ZIP export', 10, true)
on conflict (operation) do update set
  display_name = excluded.display_name,
  tokens = excluded.tokens,
  active = excluded.active,
  updated_at = now();

create table if not exists public.user_subscriptions (
  account_id uuid primary key
    references public.user_accounts(id) on delete cascade,
  plan_id text not null default 'trial'
    references public.subscription_plans(id),
  status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled', 'expired')),
  cycle_start timestamptz not null default now(),
  cycle_end timestamptz not null default (now() + interval '30 days'),
  renews_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.token_wallets (
  account_id uuid primary key
    references public.user_accounts(id) on delete cascade,
  monthly_balance integer not null default 0 check (monthly_balance >= 0),
  topup_balance integer not null default 0 check (topup_balance >= 0),
  reserved_balance integer not null default 0 check (reserved_balance >= 0),
  lifetime_used bigint not null default 0 check (lifetime_used >= 0),
  reset_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null
    references public.user_accounts(id) on delete cascade,
  operation text not null,
  reference_id text,
  description text not null default '',
  amount integer not null check (amount >= 0),
  direction text not null
    check (direction in ('credit', 'reserve', 'debit', 'refund', 'adjustment')),
  status text not null default 'completed'
    check (status in ('reserved', 'completed', 'refunded', 'cancelled')),
  monthly_amount integer not null default 0 check (monthly_amount >= 0),
  topup_amount integer not null default 0 check (topup_amount >= 0),
  balance_after integer not null default 0 check (balance_after >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_token_ledger_account_created
  on public.token_ledger(account_id, created_at desc);
create index if not exists idx_token_ledger_reference
  on public.token_ledger(reference_id);
create index if not exists idx_user_subscriptions_cycle
  on public.user_subscriptions(status, cycle_end);

alter table public.subscription_plans enable row level security;
alter table public.token_operation_costs enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.token_wallets enable row level security;
alter table public.token_ledger enable row level security;

create or replace function public.nexora_initialize_billing(
  p_account_id uuid,
  p_plan_id text default 'trial'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_cycle_end timestamptz;
begin
  select * into v_plan
  from public.subscription_plans
  where id = p_plan_id and active = true;

  if not found then
    raise exception 'NEXORA_PLAN_NOT_FOUND';
  end if;

  v_cycle_end := now() + interval '30 days';

  insert into public.user_subscriptions (
    account_id, plan_id, status, cycle_start, cycle_end, renews_at
  ) values (
    p_account_id,
    v_plan.id,
    'active',
    now(),
    v_cycle_end,
    case when v_plan.recurring then v_cycle_end else null end
  ) on conflict (account_id) do nothing;

  insert into public.token_wallets (
    account_id,
    monthly_balance,
    topup_balance,
    reserved_balance,
    lifetime_used,
    reset_at
  ) values (
    p_account_id,
    v_plan.monthly_tokens,
    0,
    0,
    0,
    v_cycle_end
  ) on conflict (account_id) do nothing;
end;
$$;

create or replace function public.nexora_user_account_billing_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.nexora_initialize_billing(new.id, 'trial');
  return new;
end;
$$;

drop trigger if exists user_accounts_initialize_billing
  on public.user_accounts;
create trigger user_accounts_initialize_billing
after insert on public.user_accounts
for each row execute function public.nexora_user_account_billing_trigger();

-- Backfill billing for accounts created before this migration.
do $$
declare
  v_account record;
begin
  for v_account in select id from public.user_accounts loop
    perform public.nexora_initialize_billing(v_account.id, 'trial');
  end loop;
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
  v_account public.user_accounts%rowtype;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_available integer;
begin
  perform public.nexora_initialize_billing(p_account_id, 'trial');

  select * into v_account
  from public.user_accounts
  where id = p_account_id;

  if not found then
    raise exception 'NEXORA_ACCOUNT_NOT_FOUND';
  end if;

  select * into v_sub
  from public.user_subscriptions
  where account_id = p_account_id
  for update;

  select * into v_plan
  from public.subscription_plans
  where id = v_sub.plan_id;

  select * into v_wallet
  from public.token_wallets
  where account_id = p_account_id
  for update;

  if v_sub.status = 'active' and now() >= v_sub.cycle_end then
    if v_plan.recurring then
      v_new_start := v_sub.cycle_end;
      v_new_end := v_sub.cycle_end + interval '1 month';

      while v_new_end <= now() loop
        v_new_start := v_new_end;
        v_new_end := v_new_end + interval '1 month';
      end loop;

      update public.user_subscriptions
      set
        cycle_start = v_new_start,
        cycle_end = v_new_end,
        renews_at = v_new_end,
        updated_at = now()
      where account_id = p_account_id
      returning * into v_sub;

      update public.token_wallets
      set
        monthly_balance = v_plan.monthly_tokens,
        reset_at = v_new_end,
        updated_at = now()
      where account_id = p_account_id
      returning * into v_wallet;

      insert into public.token_ledger (
        account_id,
        operation,
        description,
        amount,
        direction,
        status,
        monthly_amount,
        balance_after,
        completed_at,
        metadata
      ) values (
        p_account_id,
        'monthly_refill',
        v_plan.name || ' monthly token refill',
        v_plan.monthly_tokens,
        'credit',
        'completed',
        v_plan.monthly_tokens,
        v_wallet.monthly_balance + v_wallet.topup_balance,
        now(),
        jsonb_build_object('planId', v_plan.id, 'cycleEnd', v_new_end)
      );

      update public.approved_users
      set status = 'active', expires_at = v_new_end
      where email = lower(v_account.internal_email);
    else
      update public.user_subscriptions
      set status = 'expired', updated_at = now()
      where account_id = p_account_id
      returning * into v_sub;

      update public.approved_users
      set status = 'expired', expires_at = v_sub.cycle_end
      where email = lower(v_account.internal_email);
    end if;
  end if;

  select * into v_plan
  from public.subscription_plans
  where id = v_sub.plan_id;

  select * into v_wallet
  from public.token_wallets
  where account_id = p_account_id;

  v_available := v_wallet.monthly_balance + v_wallet.topup_balance;

  return jsonb_build_object(
    'accountId', p_account_id,
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'name', v_plan.name,
      'monthlyPriceInr', v_plan.monthly_price_inr,
      'monthlyTokens', v_plan.monthly_tokens,
      'recurring', v_plan.recurring
    ),
    'subscription', jsonb_build_object(
      'status', v_sub.status,
      'cycleStart', v_sub.cycle_start,
      'cycleEnd', v_sub.cycle_end,
      'renewsAt', v_sub.renews_at
    ),
    'wallet', jsonb_build_object(
      'monthlyBalance', v_wallet.monthly_balance,
      'topupBalance', v_wallet.topup_balance,
      'reservedBalance', v_wallet.reserved_balance,
      'available', v_available,
      'lifetimeUsed', v_wallet.lifetime_used,
      'resetAt', v_wallet.reset_at
    )
  );
end;
$$;

create or replace function public.nexora_wallet_snapshot_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select id into v_account_id
  from public.user_accounts
  where internal_email = lower(p_email)
  limit 1;

  if v_account_id is null then
    return null;
  end if;

  return public.nexora_wallet_snapshot(v_account_id);
end;
$$;

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
  v_snapshot jsonb;
  v_wallet public.token_wallets%rowtype;
  v_monthly integer;
  v_topup integer;
  v_available integer;
  v_reservation_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'NEXORA_INVALID_TOKEN_AMOUNT';
  end if;

  v_snapshot := public.nexora_wallet_snapshot(p_account_id);

  if coalesce(v_snapshot #>> '{subscription,status}', '') <> 'active' then
    raise exception 'NEXORA_SUBSCRIPTION_INACTIVE';
  end if;

  select * into v_wallet
  from public.token_wallets
  where account_id = p_account_id
  for update;

  v_available := v_wallet.monthly_balance + v_wallet.topup_balance;

  if v_available < p_amount then
    raise exception 'NEXORA_INSUFFICIENT_TOKENS:%:%', v_available, p_amount;
  end if;

  v_monthly := least(v_wallet.monthly_balance, p_amount);
  v_topup := p_amount - v_monthly;

  update public.token_wallets
  set
    monthly_balance = monthly_balance - v_monthly,
    topup_balance = topup_balance - v_topup,
    reserved_balance = reserved_balance + p_amount,
    updated_at = now()
  where account_id = p_account_id
  returning * into v_wallet;

  insert into public.token_ledger (
    account_id,
    operation,
    reference_id,
    description,
    amount,
    direction,
    status,
    monthly_amount,
    topup_amount,
    balance_after,
    metadata
  ) values (
    p_account_id,
    p_operation,
    p_reference_id,
    p_description,
    p_amount,
    'reserve',
    'reserved',
    v_monthly,
    v_topup,
    v_wallet.monthly_balance + v_wallet.topup_balance,
    jsonb_build_object('reservedAt', now())
  ) returning id into v_reservation_id;

  return jsonb_build_object(
    'reservationId', v_reservation_id,
    'amount', p_amount,
    'available', v_wallet.monthly_balance + v_wallet.topup_balance
  );
end;
$$;

create or replace function public.nexora_finalize_tokens(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.token_ledger%rowtype;
  v_wallet public.token_wallets%rowtype;
begin
  select * into v_entry
  from public.token_ledger
  where id = p_reservation_id
  for update;

  if not found then
    raise exception 'NEXORA_RESERVATION_NOT_FOUND';
  end if;

  if v_entry.status = 'completed' then
    return public.nexora_wallet_snapshot(v_entry.account_id);
  end if;

  if v_entry.status <> 'reserved' then
    raise exception 'NEXORA_RESERVATION_NOT_ACTIVE';
  end if;

  update public.token_wallets
  set
    reserved_balance = greatest(0, reserved_balance - v_entry.amount),
    lifetime_used = lifetime_used + v_entry.amount,
    updated_at = now()
  where account_id = v_entry.account_id
  returning * into v_wallet;

  update public.token_ledger
  set
    direction = 'debit',
    status = 'completed',
    completed_at = now(),
    balance_after = v_wallet.monthly_balance + v_wallet.topup_balance,
    metadata = metadata || jsonb_build_object('completedAt', now())
  where id = p_reservation_id;

  return public.nexora_wallet_snapshot(v_entry.account_id);
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
  select * into v_entry
  from public.token_ledger
  where id = p_reservation_id
  for update;

  if not found then
    raise exception 'NEXORA_RESERVATION_NOT_FOUND';
  end if;

  if v_entry.status = 'refunded' then
    return public.nexora_wallet_snapshot(v_entry.account_id);
  end if;

  if v_entry.status <> 'reserved' then
    return public.nexora_wallet_snapshot(v_entry.account_id);
  end if;

  update public.token_wallets
  set
    monthly_balance = monthly_balance + v_entry.monthly_amount,
    topup_balance = topup_balance + v_entry.topup_amount,
    reserved_balance = greatest(0, reserved_balance - v_entry.amount),
    updated_at = now()
  where account_id = v_entry.account_id
  returning * into v_wallet;

  update public.token_ledger
  set
    direction = 'refund',
    status = 'refunded',
    completed_at = now(),
    balance_after = v_wallet.monthly_balance + v_wallet.topup_balance,
    metadata = metadata || jsonb_build_object(
      'refundedAt', now(),
      'reason', left(coalesce(p_reason, 'Operation failed'), 500)
    )
  where id = p_reservation_id;

  return public.nexora_wallet_snapshot(v_entry.account_id);
end;
$$;

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
declare
  v_plan public.subscription_plans%rowtype;
  v_wallet public.token_wallets%rowtype;
  v_account public.user_accounts%rowtype;
  v_end timestamptz;
  v_remove integer;
  v_from_topup integer;
begin
  if p_status not in ('active', 'paused', 'cancelled', 'expired') then
    raise exception 'NEXORA_INVALID_SUBSCRIPTION_STATUS';
  end if;

  select * into v_plan
  from public.subscription_plans
  where id = p_plan_id and active = true;

  if not found then
    raise exception 'NEXORA_PLAN_NOT_FOUND';
  end if;

  select * into v_account
  from public.user_accounts
  where id = p_account_id;

  if not found then
    raise exception 'NEXORA_ACCOUNT_NOT_FOUND';
  end if;

  perform public.nexora_initialize_billing(p_account_id, p_plan_id);

  select * into v_wallet
  from public.token_wallets
  where account_id = p_account_id
  for update;

  if v_wallet.reserved_balance > 0 then
    raise exception 'NEXORA_ACTIVE_RESERVATIONS';
  end if;

  v_end := coalesce(p_cycle_end, now() + interval '30 days');

  update public.user_subscriptions
  set
    plan_id = p_plan_id,
    status = p_status,
    cycle_start = now(),
    cycle_end = v_end,
    renews_at = case
      when p_status = 'active' and v_plan.recurring then v_end
      else null
    end,
    cancelled_at = case
      when p_status = 'cancelled' then now()
      else null
    end,
    updated_at = now()
  where account_id = p_account_id;

  update public.token_wallets
  set
    monthly_balance = v_plan.monthly_tokens,
    reset_at = v_end,
    updated_at = now()
  where account_id = p_account_id
  returning * into v_wallet;

  if p_token_adjustment > 0 then
    update public.token_wallets
    set topup_balance = topup_balance + p_token_adjustment,
        updated_at = now()
    where account_id = p_account_id
    returning * into v_wallet;
  elsif p_token_adjustment < 0 then
    v_remove := abs(p_token_adjustment);

    if v_wallet.monthly_balance + v_wallet.topup_balance < v_remove then
      raise exception 'NEXORA_ADJUSTMENT_EXCEEDS_BALANCE';
    end if;

    v_from_topup := least(v_wallet.topup_balance, v_remove);

    update public.token_wallets
    set
      topup_balance = topup_balance - v_from_topup,
      monthly_balance = monthly_balance - (v_remove - v_from_topup),
      updated_at = now()
    where account_id = p_account_id
    returning * into v_wallet;
  end if;

  insert into public.token_ledger (
    account_id,
    operation,
    description,
    amount,
    direction,
    status,
    monthly_amount,
    topup_amount,
    balance_after,
    completed_at,
    metadata
  ) values (
    p_account_id,
    'admin_billing_update',
    'Admin changed plan or token balance',
    abs(p_token_adjustment),
    'adjustment',
    'completed',
    0,
    greatest(p_token_adjustment, 0),
    v_wallet.monthly_balance + v_wallet.topup_balance,
    now(),
    jsonb_build_object(
      'planId', p_plan_id,
      'status', p_status,
      'cycleEnd', v_end,
      'tokenAdjustment', p_token_adjustment
    )
  );

  update public.approved_users
  set
    status = case
      when p_status = 'active' then 'active'
      when p_status = 'paused' then 'blocked'
      else 'expired'
    end,
    expires_at = v_end
  where email = lower(v_account.internal_email);

  return public.nexora_wallet_snapshot(p_account_id);
end;
$$;

-- Existing username accounts become 30-day trial accounts when they did not have expiry.
update public.approved_users au
set expires_at = us.cycle_end
from public.user_accounts ua
join public.user_subscriptions us on us.account_id = ua.id
where au.email = lower(ua.internal_email)
  and au.expires_at is null;

-- Service-role backend calls these functions. No direct client policies are added.

-- Security-definer billing functions are backend-only.
revoke all on function public.nexora_initialize_billing(uuid, text) from public, anon, authenticated;
revoke all on function public.nexora_wallet_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.nexora_wallet_snapshot_by_email(text) from public, anon, authenticated;
revoke all on function public.nexora_reserve_tokens(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.nexora_finalize_tokens(uuid) from public, anon, authenticated;
revoke all on function public.nexora_refund_tokens(uuid, text) from public, anon, authenticated;
revoke all on function public.nexora_admin_set_billing(uuid, text, text, timestamptz, integer) from public, anon, authenticated;

grant execute on function public.nexora_initialize_billing(uuid, text) to service_role;
grant execute on function public.nexora_wallet_snapshot(uuid) to service_role;
grant execute on function public.nexora_wallet_snapshot_by_email(text) to service_role;
grant execute on function public.nexora_reserve_tokens(uuid, integer, text, text, text) to service_role;
grant execute on function public.nexora_finalize_tokens(uuid) to service_role;
grant execute on function public.nexora_refund_tokens(uuid, text) to service_role;
grant execute on function public.nexora_admin_set_billing(uuid, text, text, timestamptz, integer) to service_role;
