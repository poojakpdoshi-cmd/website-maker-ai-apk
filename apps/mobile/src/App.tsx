import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { Browser } from '@capacitor/browser';
import AdminPanelV5 from './AdminPanelV5';

type RuntimeConfig = { apiBase: string; supabaseUrl: string; supabaseAnonKey: string };
type WebsitePlan = { businessName: string; websiteType: string; tagline: string; pages: string[]; features: string[]; theme: { style: string; primary: string; secondary: string; background: string; text: string } };
type GenerateResponse = { projectId: string; jobId?: string; versionNumber?: number; plan: WebsitePlan; previewHtml: string; framework: 'vite-react'; fileCount: number; mode: 'ai' | 'built-in' };
type AccessResponse = { approved: true; role: 'admin' | 'subscriber'; maxDevices: number; activeDevices: number };
type UsernameSession = {
  token: string;
  expiresAt: string;
  username: string;
  internalEmail: string;
  approved: true;
  role: 'admin' | 'subscriber';
  maxDevices: number;
  activeDevices: number;
};
type ProjectSummary = { id: string; name: string; website_type: string; status: string; framework: string; github_repository?: string | null; production_url?: string | null; deployment_state?: string | null; created_at: string };
type IntegrationStatus = { github: { external_account_name?: string | null } | null; vercel: { external_account_name?: string | null } | null };

const ownerEmail = 'poojakpdoshi@gmail.com';
const configKey = 'wmai-runtime-config';
const userSessionKey = 'webforge-user-session';

function defaultConfig(): RuntimeConfig {
  return {
    apiBase: (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, ''),
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  };
}

function loadConfig(): RuntimeConfig {
  try {
    const stored = localStorage.getItem(configKey);
    return stored ? { ...defaultConfig(), ...JSON.parse(stored) } : defaultConfig();
  } catch {
    return defaultConfig();
  }
}

function createInstallationId(): string {
  const stored = localStorage.getItem('wmai-installation-id');
  if (stored) return stored;
  const value = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
  localStorage.setItem('wmai-installation-id', value);
  return value;
}

const installationId = createInstallationId();

function validConfig(config: RuntimeConfig) {
  return /^https?:\/\//.test(config.apiBase) && /^https:\/\//.test(config.supabaseUrl) && config.supabaseAnonKey.length > 20;
}

export default function App() {
  const [config, setConfig] = useState<RuntimeConfig>(loadConfig);
  const [showSetup, setShowSetup] = useState(() => !validConfig(loadConfig()));
  const [mode, setMode] = useState<'user' | 'admin-login' | 'admin-dashboard'>('user');
  const supabase = useMemo<SupabaseClient | null>(() => validConfig(config) ? createClient(config.supabaseUrl, config.supabaseAnonKey) : null, [config]);

  const [email, setEmail] = useState(ownerEmail);
  const [session, setSession] = useState<Session | null>(null);
  const [userSession, setUserSession] =
    useState<UsernameSession | null>(() => {
      try {
        const stored = localStorage.getItem(userSessionKey);
        return stored ? JSON.parse(stored) : null;
      } catch {
        return null;
      }
    });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [approved, setApproved] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [access, setAccess] = useState<AccessResponse | null>(null);
  const [prompt, setPrompt] = useState('Create a premium modern website for a jewellery shop named Raj Jewels with products, WhatsApp number +919876543210, gallery, enquiry form and SEO.');
  const [editInstruction, setEditInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [connections, setConnections] = useState<IntegrationStatus>({ github: null, vercel: null });
  const [githubToken, setGithubToken] = useState('');
  const [vercelToken, setVercelToken] = useState('');
  const [connectingProvider, setConnectingProvider] =
    useState<'github' | 'vercel' | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'create' | 'preview' | 'projects' | 'connect' | 'account'>('create');

  const token = userSession?.token || session?.access_token || '';
  const status = useMemo(() => result ? `${result.plan.businessName} • ${result.framework} • ${result.fileCount} files • ${result.mode === 'ai' ? 'Gemini-assisted brain' : 'Built-in brain'}` : 'No website generated yet', [result]);

  async function readResponse(response: Response) {
    const data = await response.json().catch(() => ({ error: 'The server returned an invalid response.' }));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function authHeaders(activeToken = token) {
    return { Authorization: `Bearer ${activeToken}`, 'X-Device-Id': installationId };
  }

  async function checkAccess(activeEmail: string, activeToken: string) {
    const response = await fetch(`${config.apiBase}/auth/check-access`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${activeToken}` },
      body: JSON.stringify({ email: activeEmail, installationId, deviceName: navigator.platform || 'Android device', androidVersion: navigator.userAgent.slice(0, 150) })
    });
    const data = await readResponse(response) as AccessResponse;
    setAccess(data); setApproved(true); return data;
  }

  async function loadProjects(activeEmail = email, activeToken = token) {
    if (!activeEmail || !activeToken) return;
    const response = await fetch(`${config.apiBase}/projects?email=${encodeURIComponent(activeEmail)}`, { headers: authHeaders(activeToken) });
    const data = await readResponse(response) as { projects: ProjectSummary[] };
    setProjects(data.projects || []);
  }

  async function loadConnections(activeEmail = email, activeToken = token) {
    if (!activeEmail || !activeToken) return;
    const response = await fetch(`${config.apiBase}/integrations/status?email=${encodeURIComponent(activeEmail)}`, { headers: authHeaders(activeToken) });
    const data = await readResponse(response) as IntegrationStatus;
    setConnections(data);
  }

  async function bootstrap(activeSession: Session) {
    const activeEmail = activeSession.user.email?.toLowerCase();
    if (!activeEmail) throw new Error('Your Supabase account has no email address.');
    setSession(activeSession); setEmail(activeEmail);
    await checkAccess(activeEmail, activeSession.access_token);
    await Promise.all([loadProjects(activeEmail, activeSession.access_token), loadConnections(activeEmail, activeSession.access_token)]);
  }

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => { if (data.session) void bootstrap(data.session).catch(() => void supabase.auth.signOut()); });
    const { data } = supabase.auth.onAuthStateChange((_event, activeSession) => {
      if (!activeSession) { setSession(null); setApproved(false); }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);


  // RESTORE_USERNAME_SESSION
  useEffect(() => {
    const stored = localStorage.getItem(userSessionKey);
    if (!stored || !validConfig(config)) return;

    let saved: UsernameSession;

    try {
      saved = JSON.parse(stored) as UsernameSession;
    } catch {
      localStorage.removeItem(userSessionKey);
      return;
    }

    void fetch(`${config.apiBase}/auth/me`, {
      headers: {
        Authorization: `Bearer ${saved.token}`,
        'X-Device-Id': installationId
      }
    })
      .then(readResponse)
      .then(async (data) => {
        const refreshed: UsernameSession = {
          ...saved,
          ...data,
          token: saved.token
        };

        localStorage.setItem(
          userSessionKey,
          JSON.stringify(refreshed)
        );

        setUserSession(refreshed);
        setSession(null);
        setEmail(refreshed.internalEmail);

        setAccess({
          approved: true,
          role: refreshed.role,
          maxDevices: refreshed.maxDevices,
          activeDevices: refreshed.activeDevices
        });

        setApproved(true);

        const guideKey =
          `webforge-token-guide-seen:${refreshed.username.toLowerCase()}`;

        if (!localStorage.getItem(guideKey)) {
          setShowSetupGuide(true);
          setTab('connect');
        }

        await Promise.all([
          loadProjects(
            refreshed.internalEmail,
            refreshed.token
          ),
          loadConnections(
            refreshed.internalEmail,
            refreshed.token
          )
        ]);
      })
      .catch(() => {
        localStorage.removeItem(userSessionKey);
        setUserSession(null);
        setApproved(false);
      });
  }, [config.apiBase]);

  function saveRuntimeConfig(next: RuntimeConfig) {
    const clean = { apiBase: next.apiBase.trim().replace(/\/$/, ''), supabaseUrl: next.supabaseUrl.trim().replace(/\/$/, ''), supabaseAnonKey: next.supabaseAnonKey.trim() };
    if (!validConfig(clean)) { setError('Enter a valid API URL, Supabase project URL, and Supabase anon key.'); return; }
    localStorage.setItem(configKey, JSON.stringify(clean));
    setConfig(clean); setShowSetup(false); setError(''); setMessage('Configuration saved inside the APK.');
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (!supabase) { setShowSetup(true); setError('Configure Supabase and the backend first.'); return; }
    if (email.trim().toLowerCase() !== ownerEmail) { setError('Email OTP is reserved for the owner. Normal users must use username and password.'); return; }
    setLoginLoading(true);
    try {
      if (!otpSent) {
        const { error: sendError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        if (sendError) throw sendError;
        setOtpSent(true); setMessage('OTP sent to your approved email.'); return;
      }
      if (!/^\d{6,8}$/.test(otp.trim())) throw new Error('Enter the OTP sent to your email.');
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token: otp.trim(), type: 'email' });
      if (verifyError || !data.session) throw verifyError || new Error('OTP verification failed.');
      await bootstrap(data.session);
    } catch (loginError) { setError(loginError instanceof Error ? loginError.message : 'Login failed.'); }
    finally { setLoginLoading(false); }
  }


  async function handleUsernameLogin(event: FormEvent) {
    event.preventDefault();
    setLoginLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${config.apiBase}/auth/login`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            username,
            password,
            installationId,
            deviceName:
              navigator.platform || 'Android device',
            androidVersion:
              navigator.userAgent.slice(0, 150)
          })
        }
      );

      const data =
        await readResponse(response) as UsernameSession;

      if (supabase) {
        await supabase.auth.signOut().catch(() => undefined);
      }

      localStorage.setItem(
        userSessionKey,
        JSON.stringify(data)
      );

      setUserSession(data);
      setSession(null);
      setEmail(data.internalEmail);

      setAccess({
        approved: true,
        role: data.role,
        maxDevices: data.maxDevices,
        activeDevices: data.activeDevices
      });

      setApproved(true);

      const guideKey =
        `webforge-token-guide-seen:${data.username.toLowerCase()}`;

      if (!localStorage.getItem(guideKey)) {
        setShowSetupGuide(true);
        setTab('connect');
      }

      setPassword('');

      await Promise.all([
        loadProjects(data.internalEmail, data.token),
        loadConnections(data.internalEmail, data.token)
      ]);
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'Username login failed.'
      );
    } finally {
      setLoginLoading(false);
    }
  }

  async function generateWebsite() {
    if (!token) return;
    setLoading(true); setError(''); setMessage('The orchestrator is planning, generating, and validating the project…');
    try {
      const response = await fetch(`${config.apiBase}/generate`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ email, installationId, prompt }) });
      const data = await readResponse(response) as GenerateResponse;
      setResult(data); setMessage('React project generated. Review it before publishing.'); await loadProjects(); setTab('preview');
    } catch (generationError) { setError(generationError instanceof Error ? generationError.message : 'Generation failed.'); }
    finally { setLoading(false); }
  }

  async function editWebsite() {
    if (!result || !editInstruction.trim()) return;
    setLoading(true); setError(''); setMessage('The AI editor is applying your changes…');
    try {
      const response = await fetch(`${config.apiBase}/projects/${result.projectId}/edit`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ email, installationId, instruction: editInstruction }) });
      const data = await readResponse(response) as GenerateResponse;
      setResult(data); setEditInstruction(''); setMessage(`Version ${data.versionNumber || 'new'} created.`); await loadProjects();
    } catch (editError) { setError(editError instanceof Error ? editError.message : 'Editing failed.'); }
    finally { setLoading(false); }
  }

  async function openProject(projectId: string) {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${config.apiBase}/projects/${projectId}?email=${encodeURIComponent(email)}`, { headers: authHeaders() });
      const data = await readResponse(response) as { version: { version_number: number; plan: WebsitePlan; preview_html: string } };
      setResult({ projectId, versionNumber: data.version.version_number, plan: data.version.plan, previewHtml: data.version.preview_html, framework: 'vite-react', fileCount: 9, mode: 'built-in' }); setTab('preview');
    } catch (projectError) { setError(projectError instanceof Error ? projectError.message : 'Could not open project.'); }
    finally { setLoading(false); }
  }


  async function connectWithToken(
    provider: 'github' | 'vercel',
    rawToken: string
  ) {
    const cleanToken = rawToken.trim();

    if (cleanToken.length < 10) {
      setError(`Paste a valid ${provider === 'github' ? 'GitHub' : 'Vercel'} access token.`);
      return;
    }

    setConnectingProvider(provider);
    setError('');
    setMessage(`Checking ${provider} token…`);

    try {
      const response = await fetch(
        `${config.apiBase}/integrations/${provider}/token`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...authHeaders()
          },
          body: JSON.stringify({
            email,
            installationId,
            token: cleanToken
          })
        }
      );

      const data = await readResponse(response) as {
        accountName?: string;
      };

      if (provider === 'github') {
        setGithubToken('');
      } else {
        setVercelToken('');
      }

      await loadConnections();

      setMessage(
        `${provider === 'github' ? 'GitHub' : 'Vercel'} connected${
          data.accountName ? ` as ${data.accountName}` : ''
        }.`
      );
    } catch (connectionError) {
      setError(
        connectionError instanceof Error
          ? connectionError.message
          : `Could not connect ${provider}.`
      );
    } finally {
      setConnectingProvider(null);
    }
  }

  async function refreshConnections() {
    setError('');
    try { await loadConnections(); setMessage('Connection status refreshed.'); }
    catch (connectionError) { setError(connectionError instanceof Error ? connectionError.message : 'Could not refresh connections.'); }
  }

  async function publishWebsite() {
    if (!result) return;
    setPublishing(true); setError(''); setMessage('Running final checks, GitHub push, and Vercel preview…');
    try {
      const response = await fetch(`${config.apiBase}/projects/${result.projectId}/publish`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ email, installationId }) });
      const data = await readResponse(response) as { productionUrl: string; state: string };
      setMessage(`Published. Vercel state: ${data.state}`); await loadProjects(); if (data.productionUrl) await Browser.open({ url: data.productionUrl });
    } catch (publishError) { setError(publishError instanceof Error ? publishError.message : 'Publishing failed.'); }
    finally { setPublishing(false); }
  }

  async function logout() {
    if (userSession?.token) {
      await fetch(`${config.apiBase}/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userSession.token}`
        }
      }).catch(() => undefined);
    }

    if (session && supabase) {
      await supabase.auth.signOut().catch(() => undefined);
    }

    localStorage.removeItem(userSessionKey);

    setUserSession(null);
    setApproved(false);
    setAccess(null);
    setSession(null);
    setEmail(ownerEmail);
    setUsername('');
    setPassword('');
    setOtp('');
    setOtpSent(false);
    setResult(null);
    setProjects([]);
    setConnections({
      github: null,
      vercel: null
    });
    setTab('create');
    setError('');
    setMessage('');
  }

  if (showSetup) return <SetupScreen config={config} onSave={saveRuntimeConfig} onCancel={validConfig(config) ? () => setShowSetup(false) : undefined} error={error} />;
  if (mode === 'admin-login' || mode === 'admin-dashboard') return <AdminPanelV5 apiBase={config.apiBase} initialMode={mode} onMode={setMode} onSetup={() => setShowSetup(true)} />;

  if (!approved) {
    return (
      <main className="login-shell">
        <section className="login-card dual-login-card">
          <div className="brand-mark logo-shell">
            <img
              src="/webforge-logo.svg"
              alt="WebForge.Ai"
            />
          </div>

          <p className="eyebrow">
            MADE BY POOJAK DOSHI
          </p>

          <h1>WebForge.Ai</h1>

          <section className="login-section">
            <p className="eyebrow">OWNER LOGIN</p>
            <p className="muted">
              Email OTP is reserved for the owner.
            </p>

            <form onSubmit={handleLogin}>
              <label>
                Owner email
                <input
                  value={ownerEmail}
                  type="email"
                  autoComplete="off"
                  readOnly
                  disabled={loginLoading}
                />
              </label>

              {otpSent && (
                <label>
                  Email OTP
                  <input
                    value={otp}
                    onChange={(event) =>
                      setOtp(
                        event.target.value
                          .replace(/\D/g, '')
                          .slice(0, 8)
                      )
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </label>
              )}

              <button
                type="submit"
                disabled={loginLoading}
              >
                {loginLoading
                  ? 'Please wait…'
                  : otpSent
                    ? 'Verify owner OTP'
                    : 'Send owner OTP'}
              </button>
            </form>

            <button
              type="button"
              className="small-button owner-admin-button"
              onClick={() => setMode('admin-login')}
            >
              Open Admin Login
            </button>
          </section>

          <div className="login-divider">
            <span>OR</span>
          </div>

          <section className="login-section">
            <p className="eyebrow">USER LOGIN</p>

            <p className="muted">
              Enter the username and password issued by the admin.
            </p>

            <form onSubmit={handleUsernameLogin} autoComplete="off">
              <label>
                Username
                <input
                  value={username}
                  onChange={(event) =>
                    setUsername(event.target.value)
                  }
                  placeholder=""
                  autoComplete="off"
                  disabled={loginLoading}
                  required
                />
              </label>

              <label>
                Password
                <input
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  type="password"
                  placeholder="Your password"
                  autoComplete="current-password"
                  disabled={loginLoading}
                  required
                />
              </label>

              <button
                type="submit"
                disabled={loginLoading}
              >
                {loginLoading
                  ? 'Signing in…'
                  : 'Log In'}
              </button>
            </form>
          </section>

          {message && (
            <p className="success">{message}</p>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  return <main className="app-shell">
    <header><div><p className="eyebrow">WEBFORGE.AI</p><h1>Build and publish without coding</h1></div><span className="pill">V4.1 • NEW BUILD</span></header>
    <nav className="webforge-app-nav">
      <button
        className={tab === 'create' ? 'active' : ''}
        onClick={() => setTab('create')}
      >
        Create
      </button>

      <button
        className={tab === 'preview' ? 'active' : ''}
        onClick={() => setTab('preview')}
      >
        Preview
      </button>

      <button
        className={tab === 'projects' ? 'active my-webs-tab' : 'my-webs-tab'}
        onClick={() => {
          setTab('projects');
          void loadProjects();
        }}
      >
        <span>My Webs</span>
        {projects.length > 0 && (
          <small className="my-webs-count">
            {projects.length}
          </small>
        )}
      </button>

      <button
        className={tab === 'connect' ? 'active' : ''}
        onClick={() => setTab('connect')}
      >
        Connect
      </button>

      <button
        className={tab === 'account' ? 'active' : ''}
        onClick={() => setTab('account')}
      >
        Account
      </button>
    </nav>
    {message && <p className="success notice-wide">{message}</p>}{error && <p className="error notice-wide" role="alert">{error}</p>}
    {tab === 'create' && <section className="panel"><p className="eyebrow">ORCHESTRATED AI BRAIN</p><h2>Describe the complete website</h2><p className="muted">Gemini assists with planning and content. The orchestrator, templates, validators, and build system remain in control.</p><div className="chips"><span>React source</span><span>Auto logo</span><span>SEO</span><span>Database form</span><span>Double validation</span><span>Vercel publish</span></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={10} maxLength={6000} /><p className="prompt-count">{prompt.length}/6000</p><button className="primary" onClick={generateWebsite} disabled={loading || prompt.trim().length < 20}>{loading ? 'Building project…' : 'Generate website'}</button></section>}
    {tab === 'preview' && <section className="panel preview-panel">{result ? <><div className="preview-top"><div><p className="eyebrow">LIVE PREVIEW</p><h2>{status}</h2></div><button onClick={publishWebsite} disabled={publishing || !connections.github || !connections.vercel}>{publishing ? 'Publishing…' : 'Push + deploy'}</button></div>{(!connections.github || !connections.vercel) && <p className="notice">Connect GitHub and Vercel before publishing.</p>}<iframe title="Generated website preview" sandbox="allow-forms allow-scripts allow-popups" srcDoc={result.previewHtml} /><div className="editor-box"><h3>AI website editor</h3><textarea value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} rows={4} placeholder="Change the theme, add pricing, remove a section…" /><button onClick={editWebsite} disabled={loading || !editInstruction.trim()}>{loading ? 'Applying changes…' : 'Apply edit'}</button></div></> : <div className="empty">Generate or open a project first.</div>}</section>}
    {tab === 'projects' && (
      <section className="panel my-webs-panel">
        <div className="my-webs-heading">
          <div>
            <p className="eyebrow">MY WEBS</p>
            <h2>All your websites</h2>
            <p className="muted">
              Open, edit or visit every website created from this account.
            </p>
          </div>

          <button
            className="my-webs-refresh"
            onClick={() => void loadProjects()}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div className="my-webs-summary">
          <span>Total websites</span>
          <strong>{projects.length}</strong>
        </div>

        <div className="project-list my-webs-list">
          {projects.length ? (
            projects.map((project) => (
              <article key={project.id}>
                <div className="my-web-details">
                  <strong>{project.name}</strong>

                  <span>
                    {project.website_type}
                    {' • '}
                    {project.framework}
                    {' • '}
                    {project.status}
                  </span>

                  {project.production_url && (
                    <small>Live website available</small>
                  )}
                </div>

                <div className="project-actions">
                  <button
                    onClick={() => void openProject(project.id)}
                  >
                    Open
                  </button>

                  {project.production_url && (
                    <a
                      href={project.production_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Live
                    </a>
                  )}

                  {project.github_repository && (
                    <a
                      href={project.github_repository}
                      target="_blank"
                      rel="noreferrer"
                    >
                      GitHub
                    </a>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="empty compact my-webs-empty">
              <strong>No websites yet</strong>
              <span>
                Create your first website and it will appear here.
              </span>
            </div>
          )}
        </div>
      </section>
    )}

    {tab === 'connect' && (
      <section className="panel">
        <p className="eyebrow">PUBLISHING ACCOUNTS</p>
        <h2>Paste access tokens</h2>
        <p className="muted">
          Tokens are sent to the backend, verified, encrypted and stored for this WebForge account.
        </p>

        <button
          type="button"
          className="refresh"
          onClick={() => setShowSetupGuide((current) => !current)}
        >
          {showSetupGuide ? 'Hide setup guide' : 'Open setup guide'}
        </button>

        {showSetupGuide && (
          <section className="panel token-setup-guide">
            <p className="eyebrow">NEW USER SETUP</p>
            <h2>GitHub and Vercel token setup</h2>

            <p className="muted">
              Use personal access tokens. Do not paste account passwords,
              OAuth Client IDs or OAuth Client Secrets.
            </p>

            <article>
              <h3>1. Create your GitHub token</h3>

              <ol>
                <li>Tap the direct GitHub button below and sign in.</li>
                <li>Keep the description as WebForge.Ai.</li>
                <li>Select an expiration date.</li>
                <li>Enable the public_repo permission.</li>
                <li>Generate and copy the token immediately.</li>
                <li>Return to WebForge.Ai and paste it in the GitHub field.</li>
              </ol>

              <button
                type="button"
                onClick={() =>
                  void Browser.open({
                    url: 'https://github.com/settings/tokens/new?scopes=public_repo&description=WebForge.Ai'
                  })
                }
              >
                Open GitHub Token Page
              </button>
            </article>

            <article>
              <h3>2. Create your Vercel token</h3>

              <ol>
                <li>Tap the direct Vercel button below and sign in.</li>
                <li>Tap Create Token.</li>
                <li>Name the token WebForge.Ai.</li>
                <li>Select the account where websites should deploy.</li>
                <li>Select an expiration date and create the token.</li>
                <li>Copy it, return here and paste it in the Vercel field.</li>
              </ol>

              <button
                type="button"
                onClick={() =>
                  void Browser.open({
                    url: 'https://vercel.com/account/settings/tokens'
                  })
                }
              >
                Open Vercel Token Page
              </button>
            </article>

            <article>
              <h3>3. Connect both accounts</h3>

              <ol>
                <li>Paste and connect the GitHub token.</li>
                <li>Paste and connect the Vercel token.</li>
                <li>Both cards must show Connected before publishing.</li>
                <li>Never share either token with another person.</li>
              </ol>

              <button
                type="button"
                onClick={() => {
                  const accountName = (
                    userSession?.username || email
                  ).toLowerCase();

                  localStorage.setItem(
                    `webforge-token-guide-seen:${accountName}`,
                    '1'
                  );

                  setShowSetupGuide(false);
                }}
              >
                Got it - Continue
              </button>
            </article>
          </section>
        )}

        <div className="connection-grid">
          <article className={connections.github ? 'connected' : ''}>
            <h3>GitHub</h3>
            <p>
              {connections.github
                ? `Connected as ${connections.github.external_account_name || 'GitHub user'}`
                : 'Paste a GitHub personal access token with repository access.'}
            </p>

            <input
              type="password"
              value={githubToken}
              onChange={(event) => setGithubToken(event.target.value)}
              placeholder="Paste GitHub access token"
              autoComplete="off"
              spellCheck={false}
            />

            <button
              onClick={() => void connectWithToken('github', githubToken)}
              disabled={
                connectingProvider !== null ||
                githubToken.trim().length < 10
              }
            >
              {connectingProvider === 'github'
                ? 'Checking GitHub…'
                : connections.github
                  ? 'Replace GitHub Token'
                  : 'Connect GitHub Token'}
            </button>
          </article>

          <article className={connections.vercel ? 'connected' : ''}>
            <h3>Vercel</h3>
            <p>
              {connections.vercel
                ? `Connected to ${connections.vercel.external_account_name || 'Vercel'}`
                : 'Paste a Vercel access token for live deployment.'}
            </p>

            <input
              type="password"
              value={vercelToken}
              onChange={(event) => setVercelToken(event.target.value)}
              placeholder="Paste Vercel access token"
              autoComplete="off"
              spellCheck={false}
            />

            <button
              onClick={() => void connectWithToken('vercel', vercelToken)}
              disabled={
                connectingProvider !== null ||
                vercelToken.trim().length < 10
              }
            >
              {connectingProvider === 'vercel'
                ? 'Checking Vercel…'
                : connections.vercel
                  ? 'Replace Vercel Token'
                  : 'Connect Vercel Token'}
            </button>
          </article>
        </div>

        <button
          className="refresh"
          onClick={refreshConnections}
          disabled={connectingProvider !== null}
        >
          Refresh connections
        </button>
      </section>
    )}
    {tab === 'account' && <section className="panel"><p className="eyebrow">ACCOUNT</p><h2>{userSession?.username || email}</h2><div className="account-grid"><article><span>Role</span><strong>{access?.role}</strong></article><article><span>Devices</span><strong>{access?.activeDevices}/{access?.maxDevices}</strong></article><article><span>GitHub</span><strong>{connections.github ? 'Connected' : 'Not connected'}</strong></article><article><span>Vercel</span><strong>{connections.vercel ? 'Connected' : 'Not connected'}</strong></article></div>{!userSession && email === ownerEmail && <button onClick={() => setMode('admin-login')}>Open Admin</button>}<button className="logout" onClick={() => void logout()}>Log out</button></section>}
    <footer>WebForge.Ai V4.1 · Made by Poojak Doshi</footer>
  </main>;
}

function SetupScreen({ config, onSave, onCancel, error }: { config: RuntimeConfig; onSave: (config: RuntimeConfig) => void; onCancel?: () => void; error: string }) {
  const [draft, setDraft] = useState(config);
  return <main className="login-shell"><section className="login-card"><div className="brand-mark">⚙</div><p className="eyebrow">ONE-TIME APP SETUP</p><h1>Connect the APK</h1><p className="muted">Paste the public backend URL and the two public Supabase values. These can be changed later without rebuilding the APK.</p><form onSubmit={(event) => { event.preventDefault(); onSave(draft); }}><label>Backend API URL<input value={draft.apiBase} onChange={(event) => setDraft({ ...draft, apiBase: event.target.value })} placeholder="https://your-api.workers.dev" /></label><label>Supabase Project URL<input value={draft.supabaseUrl} onChange={(event) => setDraft({ ...draft, supabaseUrl: event.target.value })} placeholder="https://xxxxx.supabase.co" /></label><label>Supabase anon/public key<input value={draft.supabaseAnonKey} onChange={(event) => setDraft({ ...draft, supabaseAnonKey: event.target.value })} placeholder="eyJ..." /></label><button>Save and continue</button></form>{onCancel && <button className="small-button" onClick={onCancel}>Cancel</button>}{error && <p className="error">{error}</p>}<p className="tiny">Never paste the Supabase service-role key or Gemini key here.</p></section></main>;
}

