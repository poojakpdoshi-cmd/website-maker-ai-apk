import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { enforceConversationRateLimit } from './conversation-routes';

const OWNER_EMAIL = 'poojakpdoshi@gmail.com';

type AccessResult =
  | {
      ok: true;
      role: 'admin' | 'subscriber';
      maxDevices: number;
      activeDevices: number;
      subscriptionExpiresAt: string | null;
    }
  | { ok: false; status: 403 | 409 | 503; error: string };

type Deps = {
  requireUser: (
    c: any,
    email: string,
    installationId?: string
  ) => Promise<AccessResult | null>;
  requireAdmin: (c: any) => Promise<boolean>;
  requireSupabase: (env: any) => SupabaseClient;
};

type Reservation = {
  reservationId: string | null;
  amount: number;
  unlimited: boolean;
};

export class NexoraTokenError extends Error {
  status: number;

  constructor(message: string, status = 402) {
    super(message);
    this.name = 'NexoraTokenError';
    this.status = status;
  }
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const value = error as { message?: unknown; details?: unknown; hint?: unknown };
  return [value.message, value.details, value.hint]
    .filter((item): item is string => typeof item === 'string')
    .join(' | ');
}

function isMissingBillingMigration(error: unknown): boolean {
  return /nexora_|subscription_plans|token_wallets|token_ledger|schema cache|does not exist/i.test(
    errorMessage(error)
  );
}

async function accountIdForEmail(
  supabase: SupabaseClient,
  email: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select('id')
    .eq('internal_email', email.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error('Could not load the Nexora billing account.');
  }

  return data?.id ? String(data.id) : null;
}

export async function getNexoraOperationCost(
  supabase: SupabaseClient,
  operation: string,
  fallback: number
): Promise<number> {
  const { data, error } = await supabase
    .from('token_operation_costs')
    .select('tokens,active')
    .eq('operation', operation)
    .maybeSingle();

  if (error || !data || data.active === false) return fallback;
  return Math.max(0, Number(data.tokens || fallback));
}

export async function reserveNexoraTokens(
  supabase: SupabaseClient,
  email: string,
  amount: number,
  operation: string,
  referenceId?: string,
  description?: string
): Promise<Reservation> {
  if (email.toLowerCase() === OWNER_EMAIL) {
    return { reservationId: null, amount: 0, unlimited: true };
  }

  const accountId = await accountIdForEmail(supabase, email);

  if (!accountId) {
    throw new NexoraTokenError(
      'Token wallet is unavailable for this account. Ask the owner to migrate the account.'
    );
  }

  const safeAmount = Math.max(1, Math.floor(amount));
  const { data, error } = await supabase.rpc('nexora_reserve_tokens', {
    p_account_id: accountId,
    p_amount: safeAmount,
    p_operation: operation,
    p_reference_id: referenceId || null,
    p_description: description || operation
  });

  if (error) {
    const raw = errorMessage(error);
    const match = raw.match(/NEXORA_INSUFFICIENT_TOKENS:(\d+):(\d+)/i);

    if (match) {
      throw new NexoraTokenError(
        `Not enough Nexora Tokens. ${match[1]} available, ${match[2]} required.`
      );
    }

    if (/NEXORA_SUBSCRIPTION_INACTIVE/i.test(raw)) {
      throw new NexoraTokenError(
        'Your Nexora token entitlement is not active. Ask the owner for access.',
        403
      );
    }

    if (isMissingBillingMigration(error)) {
      throw new NexoraTokenError(
        'Token system is not installed on the backend yet.',
        503
      );
    }

    throw new NexoraTokenError('Could not reserve Nexora Tokens.', 500);
  }

  const result = data as { reservationId?: unknown; amount?: unknown } | null;
  const reservationId =
    typeof result?.reservationId === 'string'
      ? result.reservationId
      : null;

  if (!reservationId) {
    throw new NexoraTokenError('Token reservation was not created.', 500);
  }

  return {
    reservationId,
    amount: Number(result?.amount || safeAmount),
    unlimited: false
  };
}

export async function finalizeNexoraTokens(
  supabase: SupabaseClient,
  reservationId: string | null
): Promise<void> {
  if (!reservationId) return;
  const { error } = await supabase.rpc('nexora_finalize_tokens', {
    p_reservation_id: reservationId
  });
  if (error) throw new Error('Could not finalize the Nexora Token charge.');
}

export async function refundNexoraTokens(
  supabase: SupabaseClient,
  reservationId: string | null,
  reason: string
): Promise<void> {
  if (!reservationId) return;
  const { error } = await supabase.rpc('nexora_refund_tokens', {
    p_reservation_id: reservationId,
    p_reason: reason.slice(0, 500)
  });
  if (error) {
    console.error('Nexora Token refund failed.', {
      code:
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'unknown'
    });
  }
}

export async function loadAdminBillingAccounts(
  supabase: SupabaseClient
): Promise<Array<Record<string, unknown>>> {
  const [{ data: accounts, error: accountError }, plansResult] = await Promise.all([
    supabase
      .from('user_accounts')
      .select('id,username,internal_email,status,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('subscription_plans')
      .select('id,name,package_tokens')
  ]);

  if (accountError) throw new Error('Could not load username accounts.');

  const accountIds = (accounts || []).map((account) => String(account.id));
  if (accountIds.length === 0) return [];

  const [{ data: subscriptions }, { data: wallets }] = await Promise.all([
    supabase
      .from('user_subscriptions')
      .select('account_id,plan_id,status')
      .in('account_id', accountIds),
    supabase
      .from('token_wallets')
      .select('account_id,monthly_balance,topup_balance,reserved_balance,lifetime_used')
      .in('account_id', accountIds)
  ]);

  const planMap = new Map<string, any>(
    (plansResult.data || []).map((plan: any) => [String(plan.id), plan])
  );
  const subscriptionMap = new Map<string, any>(
    (subscriptions || []).map((item: any) => [String(item.account_id), item])
  );
  const walletMap = new Map<string, any>(
    (wallets || []).map((item: any) => [String(item.account_id), item])
  );

  return (accounts || []).map((account) => {
    const subscription = subscriptionMap.get(String(account.id));
    const wallet = walletMap.get(String(account.id));
    const plan = subscription
      ? planMap.get(String(subscription.plan_id))
      : null;

    const monthly = Number(wallet?.monthly_balance || 0);
    const topup = Number(wallet?.topup_balance || 0);

    return {
      ...account,
      plan_id: subscription?.plan_id || 'trial',
      plan_name: plan?.name || 'Free Trial',
      plan_package_tokens: Number(plan?.package_tokens || 0),
      subscription_status: subscription?.status || 'active',
      monthly_balance: monthly,
      topup_balance: topup,
      reserved_balance: Number(wallet?.reserved_balance || 0),
      token_balance: monthly + topup,
      lifetime_used: Number(wallet?.lifetime_used || 0)
    };
  });
}

export function registerSubscriptionTokenRoutes(
  app: { get: (...args: any[]) => unknown; patch: (...args: any[]) => unknown },
  deps: Deps
): void {
  app.get('/billing/plans', async (c: any) => {
    const supabase = deps.requireSupabase(c.env);
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('id,name,package_price_inr,package_tokens,sort_order')
      .eq('package_active', true)
      .order('sort_order', { ascending: true });

    if (error) return c.json({ error: 'Could not load token packages.' }, 500);
    return c.json({ plans: data || [] });
  });

  app.get('/billing/wallet', async (c: any) => {
    const parsed = z.object({
      email: z.string().email(),
      installationId: z.string().uuid()
    }).safeParse({
      email: c.req.query('email'),
      installationId: c.req.header('X-Device-Id')
    });

    if (!parsed.success) {
      return c.json({ error: 'Email and device identifier are required.' }, 400);
    }

    const email = parsed.data.email.toLowerCase();
    const access = await deps.requireUser(c, email, parsed.data.installationId);

    if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
    if (!access.ok) {
      const denied = access as { error: string; status: number };
      return c.json({ error: denied.error }, denied.status as any);
    }

    const supabase = deps.requireSupabase(c.env);

    if (email === OWNER_EMAIL) {
      return c.json({
        unlimited: true,
        plan: {
          id: 'owner',
          name: 'Owner',
          packagePriceInr: 0,
          packageTokens: null,
          nonExpiring: true
        },
        entitlement: { status: 'active' },
        wallet: {
          reservedBalance: 0,
          available: null,
          lifetimeUsed: null,
          nonExpiring: true
        },
        ledger: [],
        costs: []
      });
    }

    const accountId = await accountIdForEmail(supabase, email);
    if (!accountId) return c.json({ error: 'Billing account not found.' }, 404);

    const { data: snapshot, error: snapshotError } = await supabase.rpc(
      'nexora_wallet_snapshot',
      { p_account_id: accountId }
    );

    if (snapshotError) {
      return c.json({ error: 'Could not load the token wallet.' }, 500);
    }

    const [{ data: ledger }, { data: costs }] = await Promise.all([
      supabase
        .from('token_transactions')
        .select('id,operation,reason,amount,transaction_type,balance_after,created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('token_operation_costs')
        .select('operation,display_name,tokens')
        .eq('active', true)
        .order('tokens', { ascending: true })
    ]);

    return c.json({
      unlimited: false,
      ...(snapshot as Record<string, unknown>),
      ledger: ledger || [],
      costs: costs || []
    });
  });

  app.patch('/admin/accounts/:id/billing', async (c: any) => {
    if (!(await deps.requireAdmin(c))) {
      return c.json({ error: 'Admin access required.' }, 401);
    }

    const rawBody = await c.req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
      return c.json({ error: 'Request body is too large.' }, 413);
    }
    const parsed = z.discriminatedUnion('action', [
      z.object({
        action: z.literal('assign_package'),
        planId: z.enum(['starter', 'pro', 'business']),
        reason: z.string().trim().min(3).max(500),
        idempotencyKey: z.string().min(8).max(160)
      }).strict(),
      z.object({
        action: z.literal('admin_bonus'),
        amount: z.number().int().min(1).max(1000000000),
        reason: z.string().trim().min(3).max(500),
        idempotencyKey: z.string().min(8).max(160)
      }).strict()
    ]).safeParse((() => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return null;
      }
    })());

    if (!parsed.success) {
      return c.json({
        error: 'A valid package or positive bonus, reason and idempotency key are required.'
      }, 400);
    }

    const supabase = deps.requireSupabase(c.env);
    const accountId = c.req.param('id');
    const rate = await enforceConversationRateLimit(
      supabase,
      accountId,
      'admin_token_grant',
      10,
      60
    ).catch(() => null);
    if (!rate) {
      return c.json({ error: 'Could not verify request limits.' }, 503);
    }
    if (!rate.allowed) {
      c.header('Retry-After', String(rate.retryAfterSeconds));
      return c.json({ error: 'Too many token grants. Try again shortly.' }, 429);
    }
    const rpcName = parsed.data.action === 'assign_package'
      ? 'nexora_grant_token_package'
      : 'nexora_grant_admin_bonus';
    const rpcArgs = parsed.data.action === 'assign_package'
      ? {
          p_account_id: accountId,
          p_plan_id: parsed.data.planId,
          p_idempotency_key: parsed.data.idempotencyKey,
          p_actor_id: OWNER_EMAIL,
          p_reason: parsed.data.reason
        }
      : {
          p_account_id: accountId,
          p_amount: parsed.data.amount,
          p_idempotency_key: parsed.data.idempotencyKey,
          p_actor_id: OWNER_EMAIL,
          p_reason: parsed.data.reason
        };
    const { data, error } = await supabase.rpc(rpcName, rpcArgs);

    if (error) {
      const raw = errorMessage(error);
      const friendly = /NEXORA_ACTIVE_RESERVATIONS/i.test(raw)
        ? 'Wait for the user’s active AI job to finish before changing billing.'
        : /NEXORA_ADJUSTMENT_EXCEEDS_BALANCE/i.test(raw)
          ? 'The deduction is larger than the current token balance.'
          : 'Could not grant Nexora Tokens.';
      return c.json({ error: friendly }, 409);
    }

    await supabase.from('audit_logs').insert({
      actor_email: OWNER_EMAIL,
      action: parsed.data.action,
      target_type: 'user_account',
      target_id: accountId,
      metadata: {
        ...parsed.data,
        targetAccountId: accountId
      }
    });

    return c.json({
      granted: true,
      operation: parsed.data.action,
      billing: data
    });
  });
}
