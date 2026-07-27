import { useEffect, useState } from 'react';
import './billing.css';

export type BillingAccount = {
  id: string;
  username: string;
  plan_id?: string;
  plan_name?: string;
  plan_package_tokens?: number;
  token_balance?: number;
  lifetime_used?: number;
};

type Props = {
  apiBase: string;
  token: string;
  account: BillingAccount;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
  onUpdated: () => Promise<void>;
};

export default function AdminBillingControls({
  apiBase,
  token,
  account,
  busy,
  onBusy,
  onMessage,
  onError,
  onUpdated
}: Props) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<'assign_package' | 'admin_bonus'>(
    'assign_package'
  );
  const [planId, setPlanId] = useState(
    ['starter', 'pro', 'business'].includes(account.plan_id || '')
      ? account.plan_id || 'starter'
      : 'starter'
  );
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [grantAttempt, setGrantAttempt] = useState<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);

  useEffect(() => {
    if (['starter', 'pro', 'business'].includes(account.plan_id || '')) {
      setPlanId(account.plan_id || 'starter');
    }
  }, [account.plan_id]);

  async function grant(): Promise<void> {
    const bonusAmount = Number.parseInt(amount, 10);
    if (action === 'admin_bonus' && (!Number.isSafeInteger(bonusAmount) || bonusAmount <= 0)) {
      onError('Enter a positive whole-number token amount.');
      return;
    }
    if (reason.trim().length < 3) {
      onError('Enter a reason for this grant.');
      return;
    }

    const description = action === 'assign_package'
      ? `${planId} token package`
      : `${bonusAmount.toLocaleString()} extra tokens`;
    if (!window.confirm(
      `Grant ${description} to ${account.username}? This grant is non-expiring and will be recorded in the audit ledger.`
    )) {
      return;
    }

    onBusy(true);
    onError('');
    onMessage('');
    const fingerprint = JSON.stringify({
      action,
      planId: action === 'assign_package' ? planId : null,
      amount: action === 'admin_bonus' ? bonusAmount : null,
      reason: reason.trim()
    });
    const idempotencyKey =
      grantAttempt?.fingerprint === fingerprint
        ? grantAttempt.idempotencyKey
        : crypto.randomUUID();
    setGrantAttempt({ fingerprint, idempotencyKey });

    try {
      const response = await fetch(
        `${apiBase}/admin/accounts/${encodeURIComponent(account.id)}/billing`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(
            action === 'assign_package'
              ? {
                  action,
                  planId,
                  reason: reason.trim(),
                  idempotencyKey
                }
              : {
                  action,
                  amount: bonusAmount,
                  reason: reason.trim(),
                  idempotencyKey
                }
          )
        }
      );

      const data = await response.json().catch(() => ({})) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Could not grant Nexora Tokens.');
      }

      setAmount('');
      setReason('');
      setGrantAttempt(null);
      onMessage(`${description} granted to ${account.username}.`);
      await onUpdated();
    } catch (saveError) {
      onError(
        saveError instanceof Error
          ? saveError.message
          : 'Could not grant Nexora Tokens.'
      );
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="admin-billing-control">
      <button
        type="button"
        className="admin-user-action-v5"
        onClick={() => setOpen(!open)}
        disabled={busy}
      >
        {open ? 'Close Tokens' : 'Packages & Tokens'}
      </button>

      {open && (
        <div className="admin-billing-editor">
          <div className="admin-billing-summary">
            <span>{account.plan_name || 'No package assigned'}</span>
            <strong>{account.token_balance || 0} tokens</strong>
            <small>{account.lifetime_used || 0} used lifetime</small>
          </div>

          <label>
            Grant type
            <select
              value={action}
              onChange={(event) =>
                setAction(event.target.value as typeof action)
              }
            >
              <option value="assign_package">Assign token package</option>
              <option value="admin_bonus">Add extra tokens</option>
            </select>
          </label>

          {action === 'assign_package' ? (
            <label>
              Package
              <select
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
              >
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </select>
            </label>
          ) : (
            <label>
              Extra tokens
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="500"
              />
            </label>
          )}

          <label>
            Reason
            <input
              type="text"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Required audit reason"
            />
          </label>

          <button
            type="button"
            className="admin-primary-v5"
            onClick={() => void grant()}
            disabled={busy}
          >
            {busy ? 'Granting…' : 'Confirm Grant'}
          </button>
        </div>
      )}
    </div>
  );
}
