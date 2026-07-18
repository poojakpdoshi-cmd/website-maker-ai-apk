import { useEffect, useState } from 'react';
import './billing.css';

type WalletResponse = {
  unlimited: boolean;
  plan: {
    id: string;
    name: string;
    monthlyPriceInr: number | null;
    monthlyTokens: number | null;
    recurring: boolean;
  };
  subscription: {
    status: string;
    cycleStart: string | null;
    cycleEnd: string | null;
    renewsAt: string | null;
  };
  wallet: {
    monthlyBalance: number | null;
    topupBalance: number | null;
    reservedBalance: number;
    available: number | null;
    lifetimeUsed: number | null;
    resetAt: string | null;
  };
  ledger: Array<{
    id: string;
    operation: string;
    description: string;
    amount: number;
    direction: string;
    status: string;
    balance_after: number;
    created_at: string;
  }>;
  costs: Array<{
    operation: string;
    display_name: string;
    tokens: number;
  }>;
};

type Props = {
  apiBase: string;
  email: string;
  token: string;
  installationId: string;
};

function formatDate(value: string | null): string {
  if (!value) return 'No expiry';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function operationLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function TokenWalletPanel({
  apiBase,
  email,
  token,
  installationId
}: Props) {
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadWallet(): Promise<void> {
    if (!email || !token) return;
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${apiBase}/billing/wallet?email=${encodeURIComponent(email)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Device-Id': installationId
          }
        }
      );

      const data = await response.json().catch(() => ({})) as
        WalletResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || 'Could not load Nexora Tokens.');
      }

      setWallet(data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load Nexora Tokens.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWallet();
  }, [apiBase, email, token, installationId]);

  if (loading && !wallet) {
    return <section className="token-wallet-card">Loading Nexora Tokens…</section>;
  }

  if (error && !wallet) {
    return (
      <section className="token-wallet-card token-wallet-error">
        <strong>Token wallet unavailable</strong>
        <span>{error}</span>
        <button type="button" onClick={() => void loadWallet()}>
          Retry
        </button>
      </section>
    );
  }

  if (!wallet) return null;

  const available = wallet.unlimited
    ? 'Unlimited'
    : String(wallet.wallet.available ?? 0);
  const allowance = wallet.unlimited
    ? 'Owner access'
    : `${wallet.wallet.available ?? 0} / ${wallet.plan.monthlyTokens ?? 0}`;
  const percent = wallet.unlimited || !wallet.plan.monthlyTokens
    ? 0
    : Math.min(
        100,
        Math.round(
          ((wallet.wallet.available || 0) / wallet.plan.monthlyTokens) * 100
        )
      );

  return (
    <section className="token-wallet-card">
      <div className="token-wallet-heading">
        <div>
          <p className="eyebrow">NEXORA TOKENS</p>
          <h3>{wallet.plan.name}</h3>
          <span>
            {wallet.unlimited
              ? 'Owner account has unlimited access.'
              : `Renews on ${formatDate(wallet.subscription.renewsAt || wallet.subscription.cycleEnd)}`}
          </span>
        </div>
        <button type="button" onClick={() => void loadWallet()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="token-wallet-balance">
        <strong>{available}</strong>
        <span>{wallet.unlimited ? 'Nexora Tokens' : 'tokens available'}</span>
      </div>

      {!wallet.unlimited && (
        <>
          <div className="token-wallet-progress" role="progressbar" aria-valuemin={0} aria-valuemax={wallet.plan.monthlyTokens || 0} aria-valuenow={wallet.wallet.available || 0}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="token-wallet-meta">
            <span>{allowance}</span>
            <span>{wallet.wallet.topupBalance || 0} top-up</span>
            <span>{wallet.wallet.reservedBalance || 0} reserved</span>
          </div>
        </>
      )}

      {wallet.costs.length > 0 && (
        <details className="token-costs">
          <summary>Token costs</summary>
          <div>
            {wallet.costs.map((cost) => (
              <span key={cost.operation}>
                {cost.display_name}: <strong>{cost.tokens}</strong>
              </span>
            ))}
          </div>
        </details>
      )}

      {wallet.ledger.length > 0 && (
        <details className="token-history">
          <summary>Recent token activity</summary>
          <div>
            {wallet.ledger.slice(0, 8).map((entry) => (
              <article key={entry.id}>
                <div>
                  <strong>{entry.description || operationLabel(entry.operation)}</strong>
                  <span>{new Date(entry.created_at).toLocaleString()}</span>
                </div>
                <b className={entry.direction === 'credit' || entry.direction === 'refund' ? 'credit' : 'debit'}>
                  {entry.direction === 'credit' || entry.direction === 'refund' ? '+' : '-'}
                  {entry.amount}
                </b>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
