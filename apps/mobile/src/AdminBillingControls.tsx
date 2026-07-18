import { useEffect, useState } from 'react';
import './billing.css';

export type BillingAccount = {
  id: string;
  username: string;
  plan_id?: string;
  plan_name?: string;
  subscription_status?: string;
  cycle_end?: string | null;
  token_balance?: number;
  monthly_balance?: number;
  topup_balance?: number;
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

function dateInputValue(value?: string | null): string {
  const date = value ? new Date(value) : new Date(Date.now() + 30 * 86400000);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

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
  const [planId, setPlanId] = useState(account.plan_id || 'trial');
  const [status, setStatus] = useState(account.subscription_status || 'active');
  const [cycleEnd, setCycleEnd] = useState(dateInputValue(account.cycle_end));
  const [tokenAdjustment, setTokenAdjustment] = useState('0');

  useEffect(() => {
    setPlanId(account.plan_id || 'trial');
    setStatus(account.subscription_status || 'active');
    setCycleEnd(dateInputValue(account.cycle_end));
  }, [account.plan_id, account.subscription_status, account.cycle_end]);

  async function save(): Promise<void> {
    const end = new Date(`${cycleEnd}T23:59:59.000Z`);
    if (Number.isNaN(end.getTime())) {
      onError('Choose a valid renewal date.');
      return;
    }

    onBusy(true);
    onError('');
    onMessage('');

    try {
      const response = await fetch(
        `${apiBase}/admin/accounts/${encodeURIComponent(account.id)}/billing`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            planId,
            status,
            cycleEnd: end.toISOString(),
            tokenAdjustment: Number.parseInt(tokenAdjustment || '0', 10) || 0
          })
        }
      );

      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not update billing.');

      setTokenAdjustment('0');
      onMessage(`Billing updated for ${account.username}.`);
      await onUpdated();
    } catch (saveError) {
      onError(saveError instanceof Error ? saveError.message : 'Could not update billing.');
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="admin-billing-control">
      <button type="button" className="admin-user-action-v5" onClick={() => setOpen(!open)} disabled={busy}>
        {open ? 'Close Billing' : 'Plan & Tokens'}
      </button>

      {open && (
        <div className="admin-billing-editor">
          <div className="admin-billing-summary">
            <span>{account.plan_name || 'Free Trial'}</span>
            <strong>{account.token_balance || 0} tokens</strong>
            <small>{account.lifetime_used || 0} used lifetime</small>
          </div>

          <label>
            Plan
            <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
              <option value="trial">Free Trial · 100</option>
              <option value="starter">Starter · ₹199 · 1,000</option>
              <option value="pro">Pro · ₹499 · 3,500</option>
              <option value="business">Business · ₹999 · 9,000</option>
            </select>
          </label>

          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
          </label>

          <label>
            Renewal / expiry
            <input type="date" value={cycleEnd} onChange={(event) => setCycleEnd(event.target.value)} />
          </label>

          <label>
            Add or deduct tokens
            <input type="number" value={tokenAdjustment} onChange={(event) => setTokenAdjustment(event.target.value)} placeholder="500 or -100" />
          </label>

          <button type="button" className="admin-primary-v5" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Apply Billing'}
          </button>
        </div>
      )}
    </div>
  );
}
