import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildWebsitePlan, reviseWebsitePlan } from '@wmai/ai-brain';
import { buildProjectFiles, projectSlug } from '@wmai/template-engine';
import type { GeneratedProjectFile, WebsitePlan } from '@wmai/shared';

type Bindings = {
  APP_NAME: string;
  PUBLIC_API_BASE_URL?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_SALT?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_PASSWORD_ITERATIONS?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_REDIRECT_URI?: string;
  VERCEL_CLIENT_ID?: string;
  VERCEL_CLIENT_SECRET?: string;
  VERCEL_REDIRECT_URI?: string;
  VERCEL_INTEGRATION_SLUG?: string;
  TOKEN_ENCRYPTION_KEY?: string;
};

type DeviceInput = { installationId: string; deviceName?: string; androidVersion?: string };
type AccessResult =
  | { ok: true; role: 'admin' | 'subscriber'; maxDevices: number; activeDevices: number }
  | { ok: false; status: 403 | 409 | 503; error: string };

type ConnectionRecord = {
  provider: 'github' | 'vercel';
  encrypted_access_token: string;
  external_account_id: string | null;
  external_account_name: string | null;
  metadata: Record<string, unknown> | null;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'] }));

const DEFAULT_ADMIN_USERNAME = 'Poojak@King';
const DEFAULT_ADMIN_PASSWORD_SALT = '664ad767ddf31d232e775b07c4818233';
const DEFAULT_ADMIN_PASSWORD_HASH = '2fb427fbbbd6bb2731268a2bce3ead659cbc90586b3df7a562d13cb8bc47bf85';
const DEFAULT_ADMIN_PASSWORD_ITERATIONS = 60000;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_MAX_LOGIN_ATTEMPTS = 5;

const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type UserSessionIdentity = {
  id: string;
  userId: string;
  username: string;
  internalEmail: string;
  expiresAt: string;
};

async function usernameSessionIdentity(
  env: Bindings,
  authorization: string | undefined
): Promise<UserSessionIdentity | null> {
  const token = authorization
    ?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) return null;

  const supabase = getSupabase(env);
  if (!supabase) return null;

  const tokenHash = await sha256Hex(token);

  const { data: session, error } = await supabase
    .from('user_sessions')
    .select(
      'id,user_id,username,internal_email,expires_at,revoked_at'
    )
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (
    error ||
    !session ||
    session.revoked_at ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }

  const { data: account } = await supabase
    .from('user_accounts')
    .select('status')
    .eq('id', session.user_id)
    .maybeSingle();

  if (!account || account.status !== 'active') {
    return null;
  }

  await supabase
    .from('user_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', session.id);

  return {
    id: String(session.id),
    userId: String(session.user_id),
    username: String(session.username),
    internalEmail: String(session.internal_email).toLowerCase(),
    expiresAt: String(session.expires_at)
  };
}


function adminUsername(env: Bindings): string {
  return env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME;
}

function parseHexBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) throw new Error('Invalid hexadecimal value.');
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) result[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  return result;
}

function bytesToHex(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function passwordHash(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: toArrayBuffer(parseHexBytes(saltHex)), iterations, hash: 'SHA-256' }, key, 256);
  return bytesToHex(bits);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function adminLoginAllowed(supabase: SupabaseClient, ipHash: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const { data } = await supabase.from('admin_login_attempts').select('attempts,first_attempt_at,locked_until').eq('ip_hash', ipHash).maybeSingle();
  if (!data?.locked_until) return { allowed: true };
  const lockedUntil = new Date(data.locked_until).getTime();
  if (lockedUntil <= Date.now()) {
    await supabase.from('admin_login_attempts').delete().eq('ip_hash', ipHash);
    return { allowed: true };
  }
  return { allowed: false, retryAfterSeconds: Math.ceil((lockedUntil - Date.now()) / 1000) };
}

async function recordAdminLoginFailure(supabase: SupabaseClient, ipHash: string): Promise<void> {
  const now = Date.now();
  const { data } = await supabase.from('admin_login_attempts').select('attempts,first_attempt_at').eq('ip_hash', ipHash).maybeSingle();
  const firstAttempt = data?.first_attempt_at ? new Date(data.first_attempt_at).getTime() : 0;
  const withinWindow = firstAttempt > 0 && now - firstAttempt < ADMIN_LOCK_WINDOW_MS;
  const attempts = withinWindow ? Number(data?.attempts || 0) + 1 : 1;
  const lockedUntil = attempts >= ADMIN_MAX_LOGIN_ATTEMPTS ? new Date(now + ADMIN_LOCK_WINDOW_MS).toISOString() : null;
  await supabase.from('admin_login_attempts').upsert({
    ip_hash: ipHash,
    attempts,
    first_attempt_at: withinWindow ? data?.first_attempt_at : new Date(now).toISOString(),
    locked_until: lockedUntil,
    updated_at: new Date(now).toISOString()
  }, { onConflict: 'ip_hash' });
}

async function createAdminSession(supabase: SupabaseClient, username: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString();
  const { error } = await supabase.from('admin_sessions').insert({ token_hash: tokenHash, username, expires_at: expiresAt, last_seen_at: new Date().toISOString() });
  if (error) throw new Error('Could not create the admin session. Run migration 003_admin_password_login.sql.');
  return { token, expiresAt };
}

async function requireAdmin(c: Context<{ Bindings: Bindings }>): Promise<boolean> {
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const supabase = getSupabase(c.env);
  if (!supabase) return false;
  const { data, error } = await supabase.from('admin_sessions').select('id,expires_at,revoked_at').eq('token_hash', tokenHash).maybeSingle();
  if (error || !data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) return false;
  await supabase.from('admin_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
  return true;
}

function getSupabase(env: Bindings): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireSupabase(env: Bindings): SupabaseClient {
  const client = getSupabase(env);
  if (!client) throw new Error('Supabase is not configured. Add the backend secrets before using the app.');
  return client;
}

async function identityEmail(
  env: Bindings,
  authorization: string | undefined
): Promise<string | null> {
  const usernameIdentity = await usernameSessionIdentity(
    env,
    authorization
  );

  if (usernameIdentity) {
    return usernameIdentity.internalEmail;
  }

  const supabase = getSupabase(env);
  if (!supabase) return null;

  const token = authorization
    ?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user?.email) return null;

  return data.user.email.toLowerCase();
}

async function verifyIdentity(env: Bindings, authorization: string | undefined, rawEmail: string): Promise<boolean> {
  const verifiedEmail = await identityEmail(env, authorization);
  return Boolean(verifiedEmail && verifiedEmail === rawEmail.toLowerCase());
}

async function checkAccess(env: Bindings, rawEmail: string, device?: DeviceInput): Promise<AccessResult> {
  const email = rawEmail.toLowerCase();
  const supabase = getSupabase(env);
  if (!supabase) return { ok: false, status: 503, error: 'Database is not configured.' };

  const { data: user, error: userError } = await supabase.from('approved_users').select('email,status,expires_at,max_devices').eq('email', email).maybeSingle();
  if (userError) return { ok: false, status: 503, error: 'Could not check account access.' };
  if (!user || user.status !== 'active') return { ok: false, status: 403, error: 'This email has not been approved by the admin.' };
  if (user.expires_at && new Date(user.expires_at).getTime() < Date.now()) return { ok: false, status: 403, error: 'Subscription has expired.' };

  const maxDevices = Number(user.max_devices || 2);
  const { count } = await supabase.from('devices').select('id', { count: 'exact', head: true }).eq('email', email).is('revoked_at', null);
  let activeDevices = count || 0;
  if (!device) return { ok: true, role: 'subscriber', maxDevices, activeDevices };

  const { data: existing, error: lookupError } = await supabase.from('devices').select('id,email,revoked_at').eq('installation_id', device.installationId).maybeSingle();
  if (lookupError) return { ok: false, status: 503, error: 'Could not verify this device.' };
  if (existing && existing.email !== email) return { ok: false, status: 409, error: 'This installation is already linked to another account.' };
  if (existing?.revoked_at) return { ok: false, status: 403, error: 'This device has been revoked by the administrator.' };

  if (existing) {
    await supabase.from('devices').update({ last_seen_at: new Date().toISOString(), device_name: device.deviceName, android_version: device.androidVersion }).eq('id', existing.id);
  } else {
    if (activeDevices >= maxDevices) return { ok: false, status: 409, error: `Device limit reached. This account allows ${maxDevices} active devices.` };
    const { error: insertError } = await supabase.from('devices').insert({
      email,
      installation_id: device.installationId,
      device_name: device.deviceName || 'Android device',
      android_version: device.androidVersion || 'Unknown',
      last_seen_at: new Date().toISOString()
    });
    if (insertError) return { ok: false, status: 503, error: 'Could not register this device.' };
    activeDevices += 1;
  }
  return { ok: true, role: 'subscriber', maxDevices, activeDevices };
}

async function requireUser(c: Context<{ Bindings: Bindings }>, email: string, installationId?: string): Promise<AccessResult | null> {
  if (!(await verifyIdentity(c.env, c.req.header('Authorization'), email))) return null;
  return checkAccess(c.env, email, installationId ? { installationId } : undefined);
}

async function dailyGenerationAllowed(supabase: SupabaseClient, email: string) {
  const { data: user } = await supabase.from('approved_users').select('daily_website_limit').eq('email', email).maybeSingle();
  const limit = Number(user?.daily_website_limit || 1);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase.from('generation_jobs').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', start.toISOString());
  const used = count || 0;
  return { allowed: used < limit, limit, used };
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('TOKEN_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.');
  return new Uint8Array(hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function utf8ToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function encryptionKey(env: Bindings): Promise<CryptoKey> {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error('Token encryption is not configured.');
  return crypto.subtle.importKey('raw', toArrayBuffer(hexToBytes(env.TOKEN_ENCRYPTION_KEY)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptSecret(env: Bindings, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), new TextEncoder().encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptSecret(env: Bindings, value: string): Promise<string> {
  const [ivValue, encryptedValue] = value.split('.');
  if (!ivValue || !encryptedValue) throw new Error('Stored provider token is invalid.');
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(ivValue)) }, await encryptionKey(env), toArrayBuffer(base64ToBytes(encryptedValue)));
  return new TextDecoder().decode(decrypted);
}

function publicApiBase(c: Context<{ Bindings: Bindings }>): string {
  return c.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '') || new URL(c.req.url).origin;
}

function safeProjectName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'website';
}

async function createOauthState(supabase: SupabaseClient, email: string, provider: 'github' | 'vercel'): Promise<string> {
  const state = crypto.randomUUID();
  const { error } = await supabase.from('oauth_states').insert({ state, email, provider, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
  if (error) throw new Error('Could not start account connection.');
  return state;
}

async function consumeOauthState(supabase: SupabaseClient, state: string, provider: 'github' | 'vercel') {
  const { data, error } = await supabase.from('oauth_states').select('state,email,provider,expires_at').eq('state', state).eq('provider', provider).maybeSingle();
  if (error || !data) throw new Error('Connection request is invalid or expired.');
  await supabase.from('oauth_states').delete().eq('state', state);
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Error('Connection request has expired.');
  return data as { email: string };
}

async function saveConnection(supabase: SupabaseClient, env: Bindings, input: {
  email: string;
  provider: 'github' | 'vercel';
  accessToken: string;
  externalAccountId?: string | null;
  externalAccountName?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const encrypted = await encryptSecret(env, input.accessToken);
  const { error } = await supabase.from('provider_connections').upsert({
    email: input.email.toLowerCase(),
    provider: input.provider,
    external_account_id: input.externalAccountId || null,
    external_account_name: input.externalAccountName || null,
    encrypted_access_token: encrypted,
    metadata: input.metadata || {},
    updated_at: new Date().toISOString()
  }, { onConflict: 'email,provider' });
  if (error) throw new Error(`Could not save ${input.provider} connection.`);
}

async function getConnection(supabase: SupabaseClient, env: Bindings, email: string, provider: 'github' | 'vercel') {
  const { data, error } = await supabase.from('provider_connections').select('provider,encrypted_access_token,external_account_id,external_account_name,metadata').eq('email', email.toLowerCase()).eq('provider', provider).maybeSingle();
  if (error || !data) throw new Error(`Connect ${provider === 'github' ? 'GitHub' : 'Vercel'} before publishing.`);
  const record = data as ConnectionRecord;
  return { ...record, accessToken: await decryptSecret(env, record.encrypted_access_token) };
}

async function githubRequest(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'Website-Maker-AI',
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.message === 'string' ? `GitHub: ${data.message}` : `GitHub request failed (${response.status}).`);
  return data;
}

async function pushToGitHub(token: string, owner: string, requestedName: string, files: GeneratedProjectFile[]) {
  const repoName = `${safeProjectName(requestedName)}-${crypto.randomUUID().slice(0, 6)}`;
  const repository = await githubRequest(token, '/user/repos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: repoName, description: 'Generated by Website Maker AI', private: false, auto_init: false })
  });
  for (const file of files) {
    await githubRequest(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: `Add ${file.path}`, content: utf8ToBase64(file.content), branch: 'main' })
    });
  }
  return { repoName, url: String(repository.html_url || `https://github.com/${owner}/${repoName}`) };
}

async function deployToVercel(connection: Awaited<ReturnType<typeof getConnection>>, name: string, files: GeneratedProjectFile[], existingProject?: string | null) {
  const teamId = typeof connection.metadata?.teamId === 'string' ? connection.metadata.teamId : '';
  const query = new URLSearchParams({ forceNew: '1', skipAutoDetectionConfirmation: '1' });
  if (teamId) query.set('teamId', teamId);
  const body: Record<string, unknown> = {
    name: safeProjectName(name),
    files: files.map((file) => ({ file: file.path, data: utf8ToBase64(file.content), encoding: 'base64' })),
    target: 'production',
    projectSettings: {
      framework: 'vite',
      installCommand: 'npm install',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
      skipGitConnectDuringLink: true
    }
  };
  if (existingProject) body.project = existingProject;
  const response = await fetch(`https://api.vercel.com/v13/deployments?${query.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = data.error as Record<string, unknown> | undefined;
    throw new Error(typeof error?.message === 'string' ? `Vercel: ${error.message}` : `Vercel deployment failed (${response.status}).`);
  }
  const project = data.project as Record<string, unknown> | undefined;
  return {
    deploymentId: String(data.id || ''),
    deploymentUrl: data.url ? `https://${String(data.url)}` : '',
    readyState: String(data.readyState || data.status || 'QUEUED'),
    projectId: String(project?.id || data.name || safeProjectName(name))
  };
}

const accessSchema = z.object({
  email: z.string().email(),
  installationId: z.string().uuid().optional(),
  deviceName: z.string().max(120).optional(),
  androidVersion: z.string().max(160).optional()
});

app.get('/health', (c) => c.json({
  ok: true,
  app: c.env.APP_NAME,
  databaseConfigured: Boolean(c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY),
  aiConfigured: Boolean(c.env.GEMINI_API_KEY && c.env.GEMINI_MODEL),
  githubConfigured: Boolean(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET && c.env.GITHUB_REDIRECT_URI),
  vercelConfigured: Boolean(c.env.VERCEL_CLIENT_ID && c.env.VERCEL_CLIENT_SECRET && c.env.VERCEL_REDIRECT_URI && c.env.VERCEL_INTEGRATION_SLUG),
  timestamp: new Date().toISOString()
}));


app.post('/auth/login', async (c) => {
  const parsed = z.object({
    username: z.string().trim().min(3).max(40),
    password: z.string().min(8).max(200),
    installationId: z.string().uuid(),
    deviceName: z.string().max(120).optional(),
    androidVersion: z.string().max(160).optional()
  }).safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({
      error: 'Enter a valid username and password.'
    }, 400);
  }

  const supabase = requireSupabase(c.env);

  const username = parsed.data.username
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/\.{2,}/g, '.');

  const { data: account, error: accountError } = await supabase
    .from('user_accounts')
    .select(
      'id,username,internal_email,password_salt,password_hash,password_iterations,status'
    )
    .eq('username', username)
    .maybeSingle();

  if (
    accountError ||
    !account ||
    account.status !== 'active'
  ) {
    return c.json({
      error: 'Incorrect username or password.'
    }, 401);
  }

  const calculatedHash = await passwordHash(
    parsed.data.password,
    account.password_salt,
    Number(account.password_iterations)
  );

  if (!constantTimeEqual(
    calculatedHash,
    account.password_hash
  )) {
    return c.json({
      error: 'Incorrect username or password.'
    }, 401);
  }

  const access = await checkAccess(
    c.env,
    account.internal_email,
    {
      installationId: parsed.data.installationId,
      deviceName:
        parsed.data.deviceName || 'Android device',
      androidVersion:
        parsed.data.androidVersion || 'Unknown'
    }
  );

  if (!access.ok) {
    return c.json({ error: access.error }, access.status);
  }

  const now = new Date().toISOString();

  await supabase
    .from('user_sessions')
    .update({ revoked_at: now })
    .eq('user_id', account.id)
    .eq('installation_id', parsed.data.installationId)
    .is('revoked_at', null);

  const token = randomToken();

  const expiresAt = new Date(
    Date.now() + USER_SESSION_TTL_MS
  ).toISOString();

  const { error: sessionError } = await supabase
    .from('user_sessions')
    .insert({
      user_id: account.id,
      username: account.username,
      internal_email: account.internal_email,
      token_hash: await sha256Hex(token),
      installation_id: parsed.data.installationId,
      expires_at: expiresAt,
      last_seen_at: now
    });

  if (sessionError) {
    return c.json({
      error: 'Could not create the login session.'
    }, 500);
  }

  return c.json({
    token,
    expiresAt,
    username: account.username,
    internalEmail: account.internal_email,
    approved: true,
    role: access.role,
    maxDevices: access.maxDevices,
    activeDevices: access.activeDevices
  });
});

app.get('/auth/me', async (c) => {
  const identity = await usernameSessionIdentity(
    c.env,
    c.req.header('Authorization')
  );

  if (!identity) {
    return c.json({
      error: 'Username session is missing or expired.'
    }, 401);
  }

  const access = await checkAccess(
    c.env,
    identity.internalEmail
  );

  if (!access.ok) {
    return c.json({ error: access.error }, access.status);
  }

  return c.json({
    username: identity.username,
    internalEmail: identity.internalEmail,
    expiresAt: identity.expiresAt,
    approved: true,
    role: access.role,
    maxDevices: access.maxDevices,
    activeDevices: access.activeDevices
  });
});

app.post('/auth/logout', async (c) => {
  const token = c.req
    .header('Authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    return c.json({ loggedOut: true });
  }

  const supabase = requireSupabase(c.env);

  await supabase
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', await sha256Hex(token));

  return c.json({ loggedOut: true });
});

app.post('/auth/check-access', async (c) => {
  const body = accessSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'A valid email and device identifier are required.' }, 400);
  if (!(await verifyIdentity(c.env, c.req.header('Authorization'), body.data.email))) return c.json({ error: 'Verify this email with OTP before continuing.' }, 401);
  const device = body.data.installationId ? { installationId: body.data.installationId, deviceName: body.data.deviceName, androidVersion: body.data.androidVersion } : undefined;
  const access = await checkAccess(c.env, body.data.email, device);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  return c.json({ approved: true, role: access.role, maxDevices: access.maxDevices, activeDevices: access.activeDevices });
});

app.post('/generate', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid(), prompt: z.string().min(20).max(6000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Email, device identifier and a detailed website prompt are required.' }, 400);
  const email = parsed.data.email.toLowerCase();
  const access = await requireUser(c, email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const supabase = requireSupabase(c.env);
  if (access.role === 'subscriber') {
    const quota = await dailyGenerationAllowed(supabase, email);
    if (!quota.allowed) return c.json({ error: `Daily website limit reached (${quota.used}/${quota.limit}).` }, 429);
  }

  const projectId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const { error: jobError } = await supabase.from('generation_jobs').insert({ id: jobId, email, prompt: parsed.data.prompt, status: 'running', current_step: 'planning' });
  if (jobError) return c.json({ error: 'Could not start the generation job.' }, 500);

  try {
    const planResult = await buildWebsitePlan(parsed.data.prompt, { apiKey: c.env.GEMINI_API_KEY, model: c.env.GEMINI_MODEL });
    const { error: projectError } = await supabase.from('projects').insert({ id: projectId, email, name: planResult.plan.businessName, description: parsed.data.prompt, website_type: planResult.plan.websiteType, status: 'preview_ready', plan: planResult.plan, framework: 'vite-react' });
    if (projectError) throw new Error('Could not save the generated project.');

    let formPublicKey: string | undefined;
    if (planResult.plan.features.includes('contact-form')) {
      const { data: form, error: formError } = await supabase.from('website_forms').insert({ project_id: projectId, name: 'Contact form' }).select('public_key').single();
      if (formError) throw new Error('Could not create the website contact form.');
      formPublicKey = String(form.public_key);
    }

    const generated = buildProjectFiles(planResult.plan, { formApiBase: publicApiBase(c), formPublicKey });
    const { error: versionError } = await supabase.from('project_versions').insert({
      project_id: projectId,
      version_number: 1,
      prompt: parsed.data.prompt,
      plan: planResult.plan,
      generated_files: generated.files,
      preview_html: generated.previewHtml
    });
    if (versionError) throw new Error('Could not save the first project version.');
    await supabase.from('generation_jobs').update({ project_id: projectId, status: 'completed', current_step: 'preview_ready', output_plan: planResult.plan, completed_at: new Date().toISOString() }).eq('id', jobId);
    return c.json({ projectId, jobId, plan: planResult.plan, previewHtml: generated.previewHtml, framework: generated.framework, fileCount: generated.files.length, mode: planResult.mode });
  } catch (error) {
    await supabase.from('generation_jobs').update({ status: 'failed', current_step: 'failed', error_message: error instanceof Error ? error.message : 'Generation failed', completed_at: new Date().toISOString() }).eq('id', jobId);
    return c.json({ error: error instanceof Error ? error.message : 'Generation failed.' }, 500);
  }
});

app.post('/projects/:id/edit', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid(), instruction: z.string().min(4).max(3000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'A valid edit instruction is required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  const supabase = requireSupabase(c.env);
  const projectId = c.req.param('id');
  const { data: project } = await supabase.from('projects').select('id,email,plan').eq('id', projectId).eq('email', parsed.data.email.toLowerCase()).maybeSingle();
  if (!project) return c.json({ error: 'Project not found.' }, 404);
  const { data: latest } = await supabase.from('project_versions').select('version_number,plan').eq('project_id', projectId).order('version_number', { ascending: false }).limit(1).maybeSingle();
  if (!latest) return c.json({ error: 'Project version not found.' }, 404);
  try {
    const revised = await reviseWebsitePlan(latest.plan as WebsitePlan, parsed.data.instruction, { apiKey: c.env.GEMINI_API_KEY, model: c.env.GEMINI_MODEL });
    let { data: form } = await supabase.from('website_forms').select('public_key').eq('project_id', projectId).eq('active', true).maybeSingle();
    if (!form && revised.plan.features.includes('contact-form')) {
      const created = await supabase.from('website_forms').insert({ project_id: projectId, name: 'Contact form' }).select('public_key').single();
      if (created.error) throw new Error('Could not create the website contact form.');
      form = created.data;
    }
    const generated = buildProjectFiles(revised.plan, { formApiBase: publicApiBase(c), formPublicKey: form?.public_key ? String(form.public_key) : undefined });
    const versionNumber = Number(latest.version_number) + 1;
    const { error } = await supabase.from('project_versions').insert({ project_id: projectId, version_number: versionNumber, prompt: parsed.data.instruction, plan: revised.plan, generated_files: generated.files, preview_html: generated.previewHtml });
    if (error) throw new Error('Could not save the edited version.');
    await supabase.from('projects').update({ plan: revised.plan, name: revised.plan.businessName, website_type: revised.plan.websiteType, status: 'preview_ready', production_url: null }).eq('id', projectId);
    return c.json({ projectId, versionNumber, plan: revised.plan, previewHtml: generated.previewHtml, framework: generated.framework, fileCount: generated.files.length, mode: revised.mode });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Could not edit the website.' }, 500);
  }
});

app.get('/projects', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid() }).safeParse({ email: c.req.query('email'), installationId: c.req.header('X-Device-Id') });
  if (!parsed.success) return c.json({ error: 'Email and device identifier are required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  const supabase = requireSupabase(c.env);
  const { data, error } = await supabase.from('projects').select('id,name,website_type,status,framework,github_repository,production_url,deployment_state,created_at,updated_at').eq('email', parsed.data.email.toLowerCase()).order('created_at', { ascending: false }).limit(50);
  if (error) return c.json({ error: 'Could not load projects.' }, 500);
  return c.json({ projects: data || [] });
});

app.get('/projects/:id', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid() }).safeParse({ email: c.req.query('email'), installationId: c.req.header('X-Device-Id') });
  if (!parsed.success) return c.json({ error: 'Email and device identifier are required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  const supabase = requireSupabase(c.env);
  const { data: project } = await supabase.from('projects').select('id,name,website_type,status,framework,github_repository,production_url,deployment_state,created_at,updated_at').eq('id', c.req.param('id')).eq('email', parsed.data.email.toLowerCase()).maybeSingle();
  if (!project) return c.json({ error: 'Project not found.' }, 404);
  const { data: version } = await supabase.from('project_versions').select('version_number,plan,preview_html,created_at').eq('project_id', project.id).order('version_number', { ascending: false }).limit(1).maybeSingle();
  return c.json({ project, version });
});

app.post('/projects/:id/publish', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Email and device identifier are required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  const supabase = requireSupabase(c.env);
  const projectId = c.req.param('id');
  const { data: project } = await supabase.from('projects').select('id,email,name,plan,vercel_project_id').eq('id', projectId).eq('email', parsed.data.email.toLowerCase()).maybeSingle();
  if (!project) return c.json({ error: 'Project not found.' }, 404);
  const { data: version } = await supabase.from('project_versions').select('generated_files').eq('project_id', projectId).order('version_number', { ascending: false }).limit(1).maybeSingle();
  if (!version?.generated_files || !Array.isArray(version.generated_files)) return c.json({ error: 'Generated project files are missing.' }, 409);

  try {
    await supabase.from('projects').update({ status: 'publishing', deployment_state: 'PUBLISHING' }).eq('id', projectId);
    const github = await getConnection(supabase, c.env, parsed.data.email, 'github');
    const vercel = await getConnection(supabase, c.env, parsed.data.email, 'vercel');
    if (!github.external_account_name) throw new Error('Reconnect GitHub so the account username can be verified.');
    const files = version.generated_files as GeneratedProjectFile[];
    const repository = await pushToGitHub(github.accessToken, github.external_account_name, project.name, files);
    const deployment = await deployToVercel(vercel, `${projectSlug(project.plan as WebsitePlan)}-${projectId.slice(0, 6)}`, files, project.vercel_project_id);
    await supabase.from('projects').update({
      status: deployment.readyState === 'READY' ? 'deployed' : 'deploying',
      github_repository: repository.url,
      vercel_project_id: deployment.projectId,
      vercel_deployment_id: deployment.deploymentId,
      production_url: deployment.deploymentUrl,
      deployment_state: deployment.readyState
    }).eq('id', projectId);
    if (deployment.deploymentUrl) {
      const hostname = new URL(deployment.deploymentUrl).hostname;
      await supabase.from('website_forms').update({ allowed_domain: hostname }).eq('project_id', projectId);
    }
    return c.json({ projectId, githubRepository: repository.url, productionUrl: deployment.deploymentUrl, deploymentId: deployment.deploymentId, state: deployment.readyState });
  } catch (error) {
    await supabase.from('projects').update({ status: 'publish_failed', deployment_state: 'ERROR' }).eq('id', projectId);
    return c.json({ error: error instanceof Error ? error.message : 'Publishing failed.' }, 500);
  }
});

app.get('/projects/:id/deployment-status', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid() }).safeParse({ email: c.req.query('email'), installationId: c.req.header('X-Device-Id') });
  if (!parsed.success) return c.json({ error: 'Email and device identifier are required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  const supabase = requireSupabase(c.env);
  const { data: project } = await supabase.from('projects').select('id,vercel_deployment_id,production_url,deployment_state').eq('id', c.req.param('id')).eq('email', parsed.data.email.toLowerCase()).maybeSingle();
  if (!project?.vercel_deployment_id) return c.json({ error: 'This project has not been published.' }, 404);
  const vercel = await getConnection(supabase, c.env, parsed.data.email, 'vercel');
  const teamId = typeof vercel.metadata?.teamId === 'string' ? vercel.metadata.teamId : '';
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const response = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(project.vercel_deployment_id)}${query}`, { headers: { Authorization: `Bearer ${vercel.accessToken}` } });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return c.json({ error: 'Could not read deployment status.' }, 502);
  const state = String(data.readyState || data.status || project.deployment_state || 'UNKNOWN');
  await supabase.from('projects').update({ deployment_state: state, status: state === 'READY' ? 'deployed' : state === 'ERROR' ? 'publish_failed' : 'deploying' }).eq('id', project.id);
  return c.json({ state, productionUrl: project.production_url, inspectorUrl: data.inspectorUrl || null, errorMessage: data.errorMessage || null });
});

app.post('/public/forms/:key/submit', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Invalid form submission.' }, 400);
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 20) return c.json({ error: 'Invalid form submission.' }, 400);
  const payload: Record<string, string> = {};
  for (const [field, value] of entries) {
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(field) || typeof value !== 'string' || value.length > 3000) return c.json({ error: 'Invalid form field.' }, 400);
    payload[field] = value.trim();
  }
  if (payload._website) return c.json({ received: true });
  const supabase = requireSupabase(c.env);
  const { data: form } = await supabase.from('website_forms').select('id,active,allowed_domain').eq('public_key', key).maybeSingle();
  if (!form || !form.active) return c.json({ error: 'This form is unavailable.' }, 404);
  const origin = c.req.header('Origin');
  if (form.allowed_domain && origin && new URL(origin).hostname !== form.allowed_domain) return c.json({ error: 'This website is not allowed to use the form.' }, 403);
  const forwarded = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${forwarded}:${key}`));
  const { error } = await supabase.from('form_submissions').insert({ form_id: form.id, payload, ip_hash: bytesToBase64(new Uint8Array(hash)) });
  if (error) return c.json({ error: 'Could not save the form submission.' }, 500);
  return c.json({ received: true });
});

app.get('/integrations/status', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid() }).safeParse({ email: c.req.query('email'), installationId: c.req.header('X-Device-Id') });
  if (!parsed.success) return c.json({ error: 'Email and device identifier are required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  const supabase = requireSupabase(c.env);
  const { data } = await supabase.from('provider_connections').select('provider,external_account_name,external_account_id,updated_at').eq('email', parsed.data.email.toLowerCase());
  const map = new Map((data || []).map((item) => [item.provider, item]));
  return c.json({ github: map.get('github') || null, vercel: map.get('vercel') || null });
});

app.get('/integrations/github/start', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid() }).safeParse({ email: c.req.query('email'), installationId: c.req.header('X-Device-Id') });
  if (!parsed.success) return c.json({ error: 'Email and device identifier are required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET || !c.env.GITHUB_REDIRECT_URI || !c.env.TOKEN_ENCRYPTION_KEY) return c.json({ error: 'GitHub OAuth is not configured on the backend.' }, 503);
  const state = await createOauthState(requireSupabase(c.env), parsed.data.email, 'github');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', c.env.GITHUB_REDIRECT_URI);
  url.searchParams.set('scope', 'repo read:user user:email');
  url.searchParams.set('state', state);
  return c.json({ authorizationUrl: url.toString() });
});

app.get('/integrations/github/callback', async (c) => {
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state || !c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET || !c.env.GITHUB_REDIRECT_URI) throw new Error('GitHub connection details are missing.');
    const supabase = requireSupabase(c.env);
    const request = await consumeOauthState(supabase, state, 'github');
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'content-type': 'application/json', 'User-Agent': 'Website-Maker-AI' },
      body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET, code, redirect_uri: c.env.GITHUB_REDIRECT_URI })
    });
    const tokenData = await tokenResponse.json() as { access_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || 'GitHub did not provide an access token.');
    const profile = await githubRequest(tokenData.access_token, '/user');
    await saveConnection(supabase, c.env, {
      email: request.email,
      provider: 'github',
      accessToken: tokenData.access_token,
      externalAccountId: String(profile.id || ''),
      externalAccountName: String(profile.login || ''),
      metadata: { avatarUrl: profile.avatar_url || null }
    });
    return c.html('<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;background:#0b1020;color:white;display:grid;place-items:center;min-height:100vh;text-align:center}div{max-width:420px;padding:30px}h1{color:#79f2c0}</style><div><h1>GitHub connected</h1><p>Return to Website Maker AI. You can close this page.</p></div>');
  } catch (error) {
    return c.html(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:30px"><h1>GitHub connection failed</h1><p>${escapeHtmlForCallback(error instanceof Error ? error.message : 'Unknown error')}</p></body>`, 400);
  }
});

app.get('/integrations/vercel/start', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid() }).safeParse({ email: c.req.query('email'), installationId: c.req.header('X-Device-Id') });
  if (!parsed.success) return c.json({ error: 'Email and device identifier are required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (!c.env.VERCEL_CLIENT_ID || !c.env.VERCEL_CLIENT_SECRET || !c.env.VERCEL_REDIRECT_URI || !c.env.VERCEL_INTEGRATION_SLUG || !c.env.TOKEN_ENCRYPTION_KEY) return c.json({ error: 'Vercel integration is not configured on the backend.' }, 503);
  const state = await createOauthState(requireSupabase(c.env), parsed.data.email, 'vercel');
  const url = new URL(`https://vercel.com/integrations/${encodeURIComponent(c.env.VERCEL_INTEGRATION_SLUG)}/new`);
  url.searchParams.set('state', state);
  return c.json({ authorizationUrl: url.toString() });
});

app.get('/integrations/vercel/callback', async (c) => {
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const teamId = c.req.query('teamId') || '';
    const configurationId = c.req.query('configurationId') || '';
    if (!code || !state || !c.env.VERCEL_CLIENT_ID || !c.env.VERCEL_CLIENT_SECRET || !c.env.VERCEL_REDIRECT_URI) throw new Error('Vercel connection details are missing.');
    const supabase = requireSupabase(c.env);
    const request = await consumeOauthState(supabase, state, 'vercel');
    const tokenResponse = await fetch('https://api.vercel.com/v2/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.env.VERCEL_CLIENT_ID, client_secret: c.env.VERCEL_CLIENT_SECRET, code, redirect_uri: c.env.VERCEL_REDIRECT_URI })
    });
    const tokenData = await tokenResponse.json() as { access_token?: string; user_id?: string; team_id?: string; installation_id?: string; error?: { message?: string } };
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error?.message || 'Vercel did not provide an access token.');
    const ownerId = tokenData.team_id || teamId || tokenData.user_id || '';
    await saveConnection(supabase, c.env, {
      email: request.email,
      provider: 'vercel',
      accessToken: tokenData.access_token,
      externalAccountId: ownerId,
      externalAccountName: tokenData.team_id || teamId ? 'Vercel team' : 'Vercel user',
      metadata: { teamId: tokenData.team_id || teamId || null, configurationId: configurationId || tokenData.installation_id || null }
    });
    const next = c.req.query('next');
    if (next && /^https:\/\/vercel\.com\//.test(decodeURIComponent(next))) return c.redirect(decodeURIComponent(next));
    return c.html('<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;background:#0b1020;color:white;display:grid;place-items:center;min-height:100vh;text-align:center}div{max-width:420px;padding:30px}h1{color:#79f2c0}</style><div><h1>Vercel connected</h1><p>Return to Website Maker AI. You can close this page.</p></div>');
  } catch (error) {
    return c.html(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:30px"><h1>Vercel connection failed</h1><p>${escapeHtmlForCallback(error instanceof Error ? error.message : 'Unknown error')}</p></body>`, 400);
  }
});

function escapeHtmlForCallback(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

app.delete('/integrations/:provider', async (c) => {
  const provider = c.req.param('provider');
  if (provider !== 'github' && provider !== 'vercel') return c.json({ error: 'Unknown provider.' }, 400);
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Email and device identifier are required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  await requireSupabase(c.env).from('provider_connections').delete().eq('email', parsed.data.email.toLowerCase()).eq('provider', provider);
  return c.json({ disconnected: true });
});

app.post('/admin/auth/login', async (c) => {
  const parsed = z.object({ username: z.string().min(3).max(80), password: z.string().min(8).max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Username and password are required.' }, 400);
  const supabase = requireSupabase(c.env);
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const ipHash = await sha256Hex(ipAddress);
  const rate = await adminLoginAllowed(supabase, ipHash);
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSeconds || 900));
    return c.json({ error: 'Too many failed login attempts. Try again later.' }, 429);
  }

  const configuredUsername = adminUsername(c.env);
  const configuredSalt = c.env.ADMIN_PASSWORD_SALT || DEFAULT_ADMIN_PASSWORD_SALT;
  const configuredHash = c.env.ADMIN_PASSWORD_HASH || DEFAULT_ADMIN_PASSWORD_HASH;
  const configuredIterations = Number(c.env.ADMIN_PASSWORD_ITERATIONS || DEFAULT_ADMIN_PASSWORD_ITERATIONS);
  const candidateHash = await passwordHash(parsed.data.password, configuredSalt, configuredIterations);
  const valid = parsed.data.username === configuredUsername && constantTimeEqual(candidateHash, configuredHash);
  if (!valid) {
    await recordAdminLoginFailure(supabase, ipHash);
    return c.json({ error: 'Invalid admin username or password.' }, 401);
  }

  await supabase.from('admin_login_attempts').delete().eq('ip_hash', ipHash);
  const session = await createAdminSession(supabase, configuredUsername);
  await supabase.from('audit_logs').insert({ actor_email: configuredUsername, action: 'admin_login', target_type: 'admin_session', metadata: { ipHash } });
  return c.json({ token: session.token, expiresAt: session.expiresAt, username: configuredUsername });
});

app.post('/admin/auth/logout', async (c) => {
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return c.json({ loggedOut: true });
  const supabase = requireSupabase(c.env);
  await supabase.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', await sha256Hex(token));
  return c.json({ loggedOut: true });
});

app.get('/admin/summary', async (c) => {
  if (!(await requireAdmin(c))) return c.json({ error: 'Admin access required.' }, 401);
  const supabase = requireSupabase(c.env);
  const count = async (table: string, filter?: [string, string]) => {
    let query = supabase.from(table).select('id', { count: 'exact', head: true });
    if (filter) query = query.eq(filter[0], filter[1]);
    const result = await query;
    return result.count || 0;
  };
  const [activeSubscribers, pendingPayments, websitesGenerated, failedJobs, activeDevices, deployments] = await Promise.all([
    count('approved_users', ['status', 'active']), count('payment_requests', ['status', 'pending']), count('projects'), count('generation_jobs', ['status', 'failed']), count('devices'), count('projects', ['status', 'deployed'])
  ]);
  return c.json({ activeSubscribers, pendingPayments, websitesGenerated, failedJobs, activeDevices, deployments });
});

app.get('/admin/users', async (c) => {
  if (!(await requireAdmin(c))) return c.json({ error: 'Admin access required.' }, 401);
  const supabase = requireSupabase(c.env);
  const { data, error } = await supabase.from('approved_users').select('email,status,expires_at,max_devices,daily_website_limit,created_at').order('created_at', { ascending: false }).limit(100);
  if (error) return c.json({ error: 'Could not load users.' }, 500);
  return c.json({ users: data || [] });
});

app.post('/admin/users/approve', async (c) => {
  const parsed = z.object({ userEmail: z.string().email(), expiresAt: z.string().datetime().nullable().optional(), maxDevices: z.number().int().min(1).max(5).optional(), dailyWebsiteLimit: z.number().int().min(0).max(100).optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Valid subscriber details are required.' }, 400);
  if (!(await requireAdmin(c))) return c.json({ error: 'Admin access required.' }, 401);
  const supabase = requireSupabase(c.env);
  const userEmail = parsed.data.userEmail.toLowerCase();
  const { error: authError } = await supabase.auth.admin.createUser({ email: userEmail, email_confirm: true });
  if (authError && !/already|registered|exists/i.test(authError.message)) return c.json({ error: 'Could not create the subscriber login.' }, 500);
  const { error } = await supabase.from('approved_users').upsert({ email: userEmail, status: 'active', expires_at: parsed.data.expiresAt || null, max_devices: parsed.data.maxDevices || 2, daily_website_limit: parsed.data.dailyWebsiteLimit ?? 1, approved_at: new Date().toISOString() }, { onConflict: 'email' });
  if (error) return c.json({ error: 'Could not approve this user.' }, 500);
  await supabase.from('audit_logs').insert({ actor_email: adminUsername(c.env), action: 'approve_user', target_type: 'approved_user', target_id: userEmail });
  return c.json({ approved: true });
});


app.get('/admin/accounts', async (c) => {
  if (!(await requireAdmin(c))) {
    return c.json({ error: 'Admin access required.' }, 401);
  }

  const supabase = requireSupabase(c.env);

  const { data, error } = await supabase
    .from('user_accounts')
    .select('id,username,internal_email,status,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return c.json({
      error: 'Could not load username accounts. Run migration 004 in Supabase.'
    }, 500);
  }

  return c.json({ accounts: data || [] });
});

app.post('/admin/accounts/create', async (c) => {
  if (!(await requireAdmin(c))) {
    return c.json({ error: 'Admin access required.' }, 401);
  }

  const parsed = z.object({
    username: z.string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9._ -]+$/),

    password: z.string()
      .min(8)
      .max(200)
  }).safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({
      error: 'Use 3–40 letters, numbers, spaces, dots, dashes or underscores. Password must be at least 8 characters.'
    }, 400);
  }

  const supabase = requireSupabase(c.env);

  const username = parsed.data.username
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/\.{2,}/g, '.');
  const internalEmail = `${username}@users.webforge.local`;

  const passwordSalt = bytesToHex(
    crypto.getRandomValues(new Uint8Array(16))
  );

  const passwordIterations = 100000;

  const passwordDigest = await passwordHash(
    parsed.data.password,
    passwordSalt,
    passwordIterations
  );

  const { data: account, error: accountError } = await supabase
    .from('user_accounts')
    .insert({
      username,
      internal_email: internalEmail,
      password_salt: passwordSalt,
      password_hash: passwordDigest,
      password_iterations: passwordIterations,
      status: 'active'
    })
    .select('id,username,internal_email,status,created_at,updated_at')
    .single();

  if (accountError) {
    if (
      accountError.code === '23505' ||
      /duplicate|unique|already/i.test(accountError.message)
    ) {
      return c.json({ error: 'This username already exists.' }, 409);
    }

    return c.json({
      error: 'Could not create account. Confirm migration 004 was run in Supabase.'
    }, 500);
  }

  const { error: accessError } = await supabase
    .from('approved_users')
    .upsert({
      email: internalEmail,
      status: 'active',
      expires_at: null,
      max_devices: 2,
      daily_website_limit: 5,
      approved_at: new Date().toISOString()
    }, {
      onConflict: 'email'
    });

  if (accessError) {
    await supabase
      .from('user_accounts')
      .delete()
      .eq('id', account.id);

    return c.json({
      error: 'Could not activate account access.'
    }, 500);
  }

  await supabase.from('audit_logs').insert({
    actor_email: adminUsername(c.env),
    action: 'create_username_account',
    target_type: 'user_account',
    target_id: account.id,
    metadata: { username }
  });

  return c.json({
    created: true,
    account
  });
});

app.notFound((c) => c.json({ error: 'Route not found.' }, 404));
app.onError((error, c) => { console.error(error); return c.json({ error: error instanceof Error ? error.message : 'Unexpected server error.' }, 500); });

export default app;
