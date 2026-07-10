import React, { FormEvent, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
const storedTokenKey = 'wmai_admin_session';

type Summary = {
  activeSubscribers: number;
  pendingPayments: number;
  websitesGenerated: number;
  failedJobs: number;
  activeDevices: number;
  deployments: number;
};

type ApprovedUser = {
  email: string;
  status: string;
  expires_at: string | null;
  max_devices: number;
  daily_website_limit: number;
  created_at: string;
};

const emptySummary: Summary = { activeSubscribers: 0, pendingPayments: 0, websitesGenerated: 0, failedJobs: 0, activeDevices: 0, deployments: 0 };

function App() {
  const [username, setUsername] = useState('Poojak@King');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(() => window.sessionStorage.getItem(storedTokenKey) || '');
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [users, setUsers] = useState<ApprovedUser[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [maxDevices, setMaxDevices] = useState(2);
  const [dailyWebsiteLimit, setDailyWebsiteLimit] = useState(1);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function parse(response: Response) {
    const data = await response.json().catch(() => ({ error: 'Invalid server response.' }));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  async function loadDashboard(activeToken = token) {
    const headers = { Authorization: `Bearer ${activeToken}` };
    const [summaryResponse, usersResponse] = await Promise.all([
      fetch(`${apiBase}/admin/summary`, { headers }),
      fetch(`${apiBase}/admin/users`, { headers })
    ]);
    const [summaryData, usersData] = await Promise.all([parse(summaryResponse), parse(usersResponse)]);
    setSummary(summaryData as Summary);
    setUsers((usersData as { users: ApprovedUser[] }).users || []);
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiBase}/admin/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await parse(response) as { token: string };
      window.sessionStorage.setItem(storedTokenKey, data.token);
      setToken(data.token);
      setPassword('');
      await loadDashboard(data.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const activeToken = token;
    setToken('');
    setSummary(emptySummary);
    setUsers([]);
    window.sessionStorage.removeItem(storedTokenKey);
    if (activeToken) {
      await fetch(`${apiBase}/admin/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${activeToken}` } }).catch(() => undefined);
    }
  }

  async function approveUser(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiBase}/admin/users/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userEmail: newUserEmail,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          maxDevices,
          dailyWebsiteLimit
        })
      });
      await parse(response);
      setNewUserEmail('');
      setExpiresAt('');
      setMessage('Subscriber approved.');
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Approval failed.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    void loadDashboard(token).catch((error) => {
      window.sessionStorage.removeItem(storedTokenKey);
      setToken('');
      setMessage(error instanceof Error ? error.message : 'Admin session expired.');
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => void loadDashboard().catch(() => undefined), 30000);
    return () => window.clearInterval(timer);
  }, [token]);

  if (!token) {
    return <main className="admin-login"><section className="login-box"><div className="logo">W</div><p>WEBSITE MAKER AI</p><h1>Admin login</h1><form onSubmit={handleLogin}><label>Username<input type="text" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Admin username" autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Admin password" autoComplete="current-password" required /></label><button disabled={busy}>{busy ? 'Signing in…' : 'Open admin dashboard'}</button></form>{message && <div className="message">{message}</div>}<small>Made by Poojak Doshi</small></section></main>;
  }

  const cards: Array<[string, number]> = [
    ['Active subscribers', summary.activeSubscribers],
    ['Pending payments', summary.pendingPayments],
    ['Websites generated', summary.websitesGenerated],
    ['Failed jobs', summary.failedJobs],
    ['Active devices', summary.activeDevices],
    ['Deployments', summary.deployments]
  ];

  return <main>
    <aside><div className="logo">W</div><h2>Admin</h2><nav><button className="active">Overview</button><button>Users</button><button disabled>Payments (later)</button><button disabled>Templates (later)</button><button disabled>Deployments (later)</button><button disabled>Settings (later)</button></nav><button className="logout" onClick={() => void logout()}>Log out</button><small>Made by Poojak Doshi</small></aside>
    <section className="content"><header><div><p>WEBSITE MAKER AI</p><h1>Control centre</h1></div><div className="header-actions"><button onClick={() => void loadDashboard()}>Refresh</button><button className="mobile-logout" onClick={() => void logout()}>Log out</button></div></header>
      <div className="grid">{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong><em>Live Supabase data</em></article>)}</div>
      <section className="table"><div className="table-head"><h2>Approve subscriber</h2></div><form className="approve-form" onSubmit={approveUser}><input type="email" value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} placeholder="Subscriber email" required /><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /><input type="number" min="1" max="5" value={maxDevices} onChange={(event) => setMaxDevices(Number(event.target.value))} aria-label="Device limit" title="Device limit" /><input type="number" min="0" max="100" value={dailyWebsiteLimit} onChange={(event) => setDailyWebsiteLimit(Number(event.target.value))} aria-label="Daily website limit" title="Daily website limit" /><button disabled={busy}>Approve email</button></form>{message && <div className="message">{message}</div>}</section>
      <section className="table"><div className="table-head"><h2>Approved users</h2><span>{users.length} loaded</span></div><div className="user-table">{users.length ? users.map((user) => <article key={user.email}><div><strong>{user.email}</strong><span>{user.status} • {user.max_devices} devices • {user.daily_website_limit} website/day</span></div><time>{user.expires_at ? `Expires ${new Date(user.expires_at).toLocaleString()}` : 'No expiry'}</time></article>) : <div className="empty">No approved users yet.</div>}</div></section>
    </section>
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
