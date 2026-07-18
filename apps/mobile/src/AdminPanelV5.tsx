import { FormEvent, useEffect, useState } from 'react';
import './admin-v6.css';
import './nexora-minimal-light.css';
import AdminBillingControls, { type BillingAccount } from './AdminBillingControls';

type AdminMode = 'user' | 'admin-login' | 'admin-dashboard';

type Props = {
  apiBase: string;
  initialMode: 'admin-login' | 'admin-dashboard';
  onMode: (mode: AdminMode) => void;
  onSetup: () => void;
};

type Summary = {
  activeSubscribers: number;
  pendingPayments: number;
  websitesGenerated: number;
  failedJobs: number;
  activeDevices: number;
  deployments: number;
};

type Account = BillingAccount & {
  internal_email: string;
  status: string;
  created_at: string;
};

const adminSessionKey = 'wmai-admin-session';

const emptySummary: Summary = {
  activeSubscribers: 0,
  pendingPayments: 0,
  websitesGenerated: 0,
  failedJobs: 0,
  activeDevices: 0,
  deployments: 0
};

export default function AdminPanelV5({
  apiBase,
  initialMode,
  onMode,
  onSetup
}: Props) {
  const [adminUsername, setAdminUsername] = useState('Poojak@King');
  const [adminPassword, setAdminPassword] = useState('');

  const [token, setToken] = useState(
    () => localStorage.getItem(adminSessionKey) || ''
  );

  const [section, setSection] =
    useState<'overview' | 'users' | 'settings'>('overview');

  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordAccountId, setPasswordAccountId] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function parseResponse(response: Response) {
    const data = await response
      .json()
      .catch(() => ({ error: 'Invalid server response.' }));

    if (!response.ok) {
      throw new Error(
        data.error || `Request failed (${response.status})`
      );
    }

    return data;
  }

  async function loadDashboard(activeToken = token) {
    const headers = {
      Authorization: `Bearer ${activeToken}`
    };

    const summaryResponse = await fetch(
      `${apiBase}/admin/summary`,
      { headers }
    );

    const summaryData =
      await parseResponse(summaryResponse) as Summary;

    setSummary(summaryData);

    const accountsResponse = await fetch(
      `${apiBase}/admin/accounts`,
      { headers }
    );

    const accountsData =
      await parseResponse(accountsResponse) as {
        accounts: Account[];
      };

    setAccounts(accountsData.accounts || []);
  }

  useEffect(() => {
    if (!token) return;

    void loadDashboard(token)
      .then(() => onMode('admin-dashboard'))
      .catch(() => {
        localStorage.removeItem(adminSessionKey);
        setToken('');
        onMode('admin-login');
      });
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/admin/auth/login`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            username: adminUsername,
            password: adminPassword
          })
        }
      );

      const data = await parseResponse(response) as {
        token: string;
      };

      localStorage.setItem(adminSessionKey, data.token);
      setToken(data.token);
      setAdminPassword('');

      await loadDashboard(data.token);
      onMode('admin-dashboard');
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'Admin login failed.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/admin/accounts/create`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            username: newUsername.trim(),
            password: newPassword
          })
        }
      );

      await parseResponse(response);

      setNewUsername('');
      setNewPassword('');
      setMessage('New Nexora user created.');

      await loadDashboard();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Could not create user.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeUserPassword(account: Account) {
    if (passwordAccountId !== account.id) {
      setPasswordAccountId(account.id);
      setPasswordDraft('');
      setError('');
      setMessage('');
      return;
    }

    if (passwordDraft.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/admin/accounts/${encodeURIComponent(account.id)}/password`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ password: passwordDraft })
        }
      );

      await parseResponse(response);
      setPasswordAccountId('');
      setPasswordDraft('');
      setMessage(
        `Password changed for ${account.username}. Existing user sessions were revoked.`
      );
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : 'Could not change the user password.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(account: Account) {
    const confirmed = window.confirm(
      `Delete ${account.username}? This permanently removes the account and revokes access on every device.`
    );

    if (!confirmed) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/admin/accounts/${encodeURIComponent(account.id)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      await parseResponse(response);
      setMessage(`${account.username} was deleted.`);
      await loadDashboard();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete the user.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (token) {
      await fetch(`${apiBase}/admin/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      }).catch(() => undefined);
    }

    localStorage.removeItem(adminSessionKey);
    setToken('');
    onMode('user');
  }

  if (initialMode === 'admin-login' && !token) {
    return (
      <main className="admin-login-v5">
        <section className="admin-login-card-v5">
          <div className="admin-logo-v5">
          <img src="/nexora-logo.png" alt="Nexora.Ai" />
        </div>

          <p className="admin-kicker-v5">
            OWNER CONTROL ROOM
          </p>

          <h1>Admin access</h1>

          <p className="admin-subtitle-v5">
            Manage users, websites and deployments.
          </p>

          <form onSubmit={login}>
            <label>
              Admin username
              <input
                value={adminUsername}
                onChange={(event) =>
                  setAdminUsername(event.target.value)
                }
                autoComplete="username"
              />
            </label>

            <label>
              Admin password
              <input
                type="password"
                value={adminPassword}
                onChange={(event) =>
                  setAdminPassword(event.target.value)
                }
                autoComplete="current-password"
              />
            </label>

            <button
              className="admin-primary-v5"
              disabled={busy}
            >
              {busy ? 'Signing in…' : 'Open Control Room'}
            </button>
          </form>

          {error && (
            <p className="admin-error-v5">{error}</p>
          )}

          <div className="admin-login-links-v5">
            <button
              type="button"
              onClick={() => onMode('user')}
            >
              Return to App
            </button>

            <button
              type="button"
              onClick={onSetup}
            >
              Setup
            </button>
          </div>
        </section>
      </main>
    );
  }

  const statistics: Array<[string, number]> = [
    ['Active users', summary.activeSubscribers],
    ['Sites created', summary.websitesGenerated],
    ['Deployments', summary.deployments],
    ['Devices', summary.activeDevices]
  ];

  return (
    <main className="admin-shell-v5">
      <aside className="admin-sidebar-v5">
        <div className="admin-brand-v5">
          <div className="admin-logo-small-v5">
            <img src="/nexora-logo.png" alt="Nexora.Ai" />
          </div>

          <div>
            <strong>Nexora.Ai</strong>
            <span>Control Room</span>
          </div>
        </div>

        <nav className="admin-nav-v5">
          <button
            className={section === 'overview' ? 'active' : ''}
            onClick={() => setSection('overview')}
          >
            Overview
          </button>

          <button
            className={section === 'users' ? 'active' : ''}
            onClick={() => setSection('users')}
          >
            User Access
          </button>

          <button
            className={section === 'settings' ? 'active' : ''}
            onClick={() => setSection('settings')}
          >
            Settings
          </button>
        </nav>

        <div className="admin-sidebar-footer-v5">
          <span className="admin-live-v5">
            <i />
            Backend online
          </span>

          <button onClick={() => void logout()}>
            Exit Admin
          </button>
        </div>
      </aside>

      <section className="admin-workspace-v5">
        <header className="admin-topbar-v5">
          <div>
            <p>NEXORA CONTROL</p>

            <h1>
              {section === 'overview'
                ? 'Command center'
                : section === 'users'
                  ? 'User access'
                  : 'System settings'}
            </h1>
          </div>

          <button
            className="admin-refresh-v5"
            onClick={() => void loadDashboard()}
          >
            Sync
          </button>
        </header>

        {message && (
          <div className="admin-message-v5">
            {message}
          </div>
        )}

        {error && (
          <div className="admin-error-box-v5">
            {error}
          </div>
        )}

        {section === 'overview' && (
          <>
            <section className="admin-stats-v5">
              {statistics.map(([label, value]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </section>

            <section className="admin-focus-card-v5">
              <div>
                <p>QUICK ACTION</p>
                <h2>Create customer access</h2>
                <span>
                  Issue a username and password for a customer.
                </span>
              </div>

              <button
                className="admin-primary-v5"
                onClick={() => setSection('users')}
              >
                New Access
              </button>
            </section>
          </>
        )}

        {section === 'users' && (
          <div className="admin-users-layout-v5">
            <section className="admin-create-user-v5">
              <p className="admin-section-label-v5">
                NEW CUSTOMER
              </p>

              <h2>Issue access</h2>

              <p>
                Create one unique username and password.
              </p>

              <form onSubmit={createUser}>
                <label>
                  Username
                  <input
                    value={newUsername}
                    onChange={(event) =>
                      setNewUsername(event.target.value)
                    }
                    placeholder="customer-name"
                    autoComplete="off"
                    required
                  />
                </label>

                <label>
                  Password

                  <div className="admin-password-row-v5">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(event) =>
                        setNewPassword(event.target.value)
                      }
                      placeholder="Minimum 8 characters"
                      autoComplete="new-password"
                      required
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowPassword(!showPassword)
                      }
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                <button
                  className="admin-primary-v5"
                  disabled={busy}
                >
                  {busy ? 'Creating…' : 'Issue Access'}
                </button>
              </form>
            </section>

            <section className="admin-account-list-v5">
              <div className="admin-list-header-v5">
                <div>
                  <p className="admin-section-label-v5">
                    ACCOUNTS
                  </p>
                  <h2>Created users</h2>
                </div>

                <span>{accounts.length} total</span>
              </div>

              <div className="admin-account-rows-v5">
                {accounts.length ? (
                  accounts.map((account) => (
                    <article key={account.id}>
                      <div className="admin-avatar-v5">
                        {account.username
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>

                      <div className="admin-account-info-v5">
                        <strong>{account.username}</strong>
                        <span>
                          Created{' '}
                          {new Date(
                            account.created_at
                          ).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="admin-account-actions-v5">
                        <span
                          className={`admin-status-v5 ${account.status}`}
                        >
                          {account.status}
                        </span>

                        {passwordAccountId === account.id && (
                          <input
                            type="password"
                            className="admin-inline-password-v5"
                            value={passwordDraft}
                            onChange={(event) =>
                              setPasswordDraft(event.target.value)
                            }
                            placeholder="New password"
                            autoComplete="new-password"
                            minLength={8}
                            disabled={busy}
                          />
                        )}

                        <button
                          type="button"
                          className="admin-user-action-v5"
                          disabled={busy}
                          onClick={() =>
                            void changeUserPassword(account)
                          }
                        >
                          {passwordAccountId === account.id
                            ? 'Save Password'
                            : 'Change Password'}
                        </button>

                        {passwordAccountId === account.id && (
                          <button
                            type="button"
                            className="admin-user-action-v5"
                            disabled={busy}
                            onClick={() => {
                              setPasswordAccountId('');
                              setPasswordDraft('');
                            }}
                          >
                            Cancel
                          </button>
                        )}

                        <button
                          type="button"
                          className="admin-user-action-v5 danger"
                          disabled={busy}
                          onClick={() => void deleteUser(account)}
                        >
                          Delete User
                        </button>

                        <AdminBillingControls
                          apiBase={apiBase}
                          token={token}
                          account={account}
                          busy={busy}
                          onBusy={setBusy}
                          onMessage={setMessage}
                          onError={setError}
                          onUpdated={() => loadDashboard()}
                        />
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="admin-empty-v5">
                    No users created yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {section === 'settings' && (
          <section className="admin-settings-v5">
            <article>
              <span>Backend API</span>
              <strong>{apiBase}</strong>
            </article>

            <article>
              <span>User authentication</span>
              <strong>Username and password</strong>
            </article>

            <button onClick={onSetup}>
              Connection setup
            </button>
          </section>
        )}
      </section>
    </main>
  );
}
