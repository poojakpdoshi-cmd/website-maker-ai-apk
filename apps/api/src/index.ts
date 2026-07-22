import { registerCmsRoutes } from './cms-routes';
import { registerAssistantChatRoutes } from './assistant-chat';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  isValidNormalizedUsername,
  normalizeUsername,
  passwordRequirements,
  strongPasswordSchema
} from './auth-credentials';
import { buildWebsitePlan, reviseWebsitePlan } from '@wmai/ai-brain';
import { buildProjectFiles, projectSlug } from '@wmai/template-engine';
import {
  runCodingAgent,
  runReviewerAgent,
  runRepairAgent,
  runThinkMaxPlanningAgent
} from './ai-council';
import { validateGeneratedProject } from './project-validator';
import { parseCouncilProjectPatch, applyCouncilProjectPatch } from './council-project';
import type { GeneratedProjectFile, WebsitePlan } from '@wmai/shared';

import { injectCmsRuntime } from './cms-live';
import { registerCmsMediaRoutes } from './cms-media-routes';
import { processCmsSchedules } from './cms-scheduler';
import { buildFullStackInstruction } from "./fullstack-policy";
import { ensureFullStackArtifacts } from "./fullstack-fallback";
import { createFullStackReport } from './fullstack-report';
import {
  auditGeneratedSecurity,
  securityAuditRepairGuidance
} from './security-audit-policy';
import {
  runOptionalThinkMax,
  thinkMaxFlagSchema
} from './thinkmax';
import {
  NexoraTokenError,
  finalizeNexoraTokens,
  getNexoraOperationCost,
  loadAdminBillingAccounts,
  refreshNexoraSubscriptionByEmail,
  refundNexoraTokens,
  registerSubscriptionTokenRoutes,
  reserveNexoraTokens
} from './subscription-tokens';
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
  GROQ_API_KEY?: string;
  GROQ_CODER_MODEL?: string;
  GROQ_REVIEWER_MODEL?: string;
  CLOUDFLARE_REPAIR_MODEL?: string;
  AI?: {
    run: (
      model: string,
      input: Record<string, unknown>
    ) => Promise<unknown>;
  };
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
  | {
      ok: true;
      role: 'admin' | 'subscriber';
      maxDevices: number;
      activeDevices: number;
      subscriptionExpiresAt: string | null;
    }
  | { ok: false; status: 403 | 409 | 503; error: string };

type ConnectionRecord = {
  provider: 'github' | 'vercel';
  encrypted_access_token: string;
  external_account_id: string | null;
  external_account_name: string | null;
  metadata: Record<string, unknown> | null;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'] }));

const DEFAULT_ADMIN_USERNAME = 'Poojak@King';
const DEFAULT_ADMIN_PASSWORD_SALT = '664ad767ddf31d232e775b07c4818233';
const DEFAULT_ADMIN_PASSWORD_HASH = '2fb427fbbbd6bb2731268a2bce3ead659cbc90586b3df7a562d13cb8bc47bf85';
const DEFAULT_ADMIN_PASSWORD_ITERATIONS = 60000;
const ADMIN_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const ADMIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_MAX_LOGIN_ATTEMPTS = 5;

const USER_SESSION_EXPIRES_AT = '9999-12-31T23:59:59.999Z';

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

function logDatabaseError(
  operation: string,
  error: { code?: unknown; message?: unknown } | null
): void {
  console.error(operation, {
    code: typeof error?.code === 'string' ? error.code : 'unknown',
    message: typeof error?.message === 'string'
      ? error.message
      : 'Unknown database error.'
  });
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

  await refreshNexoraSubscriptionByEmail(supabase, email).catch((error) => {
    console.error('Subscription refresh failed:', error);
  });

  const { data: user, error: userError } = await supabase.from('approved_users').select('email,status,expires_at,max_devices').eq('email', email).maybeSingle();
  if (userError) return { ok: false, status: 503, error: 'Could not check account access.' };
  if (!user || user.status !== 'active') return { ok: false, status: 403, error: 'This email has not been approved by the admin.' };
  if (user.expires_at && new Date(user.expires_at).getTime() < Date.now()) return { ok: false, status: 403, error: 'Subscription has expired.' };

  const maxDevices = Number(user.max_devices || 2);
  const { count } = await supabase.from('devices').select('id', { count: 'exact', head: true }).eq('email', email).is('revoked_at', null);
  let activeDevices = count || 0;
  if (!device) return {
    ok: true,
    role: 'subscriber',
    maxDevices,
    activeDevices,
    subscriptionExpiresAt: user.expires_at || null
  };

  const { data: existing, error: lookupError } = await supabase.from('devices').select('id,email,revoked_at').eq('installation_id', device.installationId).maybeSingle();
  if (lookupError) return { ok: false, status: 503, error: 'Could not verify this device.' };
  if (existing && existing.email !== email) return { ok: false, status: 409, error: 'This installation is already linked to another account.' };
  if (existing?.revoked_at) return { ok: false, status: 403, error: 'This device has been revoked by the administrator.' };

  if (existing) {
    await supabase.from('devices').update({ last_seen_at: new Date().toISOString(), device_name: device.deviceName, android_version: device.androidVersion }).eq('id', existing.id);
  } else {
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
  return {
    ok: true,
    role: 'subscriber',
    maxDevices,
    activeDevices,
    subscriptionExpiresAt: user.expires_at || null
  };
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
      'X-GitHub-Api-Version': '2022-11-28',
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
    body: JSON.stringify({ name: repoName, description: 'Generated by Nexora.Ai', private: false, auto_init: false })
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
    username: z.string().min(1).max(80),
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

  const username = normalizeUsername(parsed.data.username);

  if (!isValidNormalizedUsername(username)) {
    return c.json({ error: 'Enter a valid username and password.' }, 400);
  }

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

  const expiresAt = USER_SESSION_EXPIRES_AT;

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
    activeDevices: access.activeDevices,
    subscriptionExpiresAt: access.subscriptionExpiresAt
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
    activeDevices: access.activeDevices,
    subscriptionExpiresAt: access.subscriptionExpiresAt
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

app.patch('/auth/password', async (c) => {
  const identity = await usernameSessionIdentity(
    c.env,
    c.req.header('Authorization')
  );

  if (!identity) {
    return c.json({ error: 'Your session is missing or expired. Log in again.' }, 401);
  }

  const parsed = z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: strongPasswordSchema
  }).safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({ error: passwordRequirements }, 400);
  }

  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return c.json({ error: 'Choose a new password that is different from the current password.' }, 400);
  }

  const supabase = requireSupabase(c.env);
  const { data: account, error: lookupError } = await supabase
    .from('user_accounts')
    .select('id,password_salt,password_hash,password_iterations,status')
    .eq('id', identity.userId)
    .maybeSingle();

  if (lookupError) {
    logDatabaseError('Self-service password verification failed.', lookupError);
    return c.json({ error: 'Could not verify the current password.' }, 500);
  }

  if (!account || account.status !== 'active') {
    return c.json({ error: 'Your account is not active.' }, 403);
  }

  const currentDigest = await passwordHash(
    parsed.data.currentPassword,
    account.password_salt,
    Number(account.password_iterations)
  );

  if (!constantTimeEqual(currentDigest, account.password_hash)) {
    return c.json({ error: 'The current password is incorrect.' }, 400);
  }

  const passwordSalt = bytesToHex(
    crypto.getRandomValues(new Uint8Array(16))
  );
  const passwordIterations = 100000;
  const passwordDigest = await passwordHash(
    parsed.data.newPassword,
    passwordSalt,
    passwordIterations
  );
  const changedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('user_accounts')
    .update({
      password_salt: passwordSalt,
      password_hash: passwordDigest,
      password_iterations: passwordIterations,
      password_changed_at: changedAt,
      updated_at: changedAt
    })
    .eq('id', account.id);

  if (updateError) {
    logDatabaseError('Self-service password update failed.', updateError);
    return c.json({ error: 'Could not change the password.' }, 500);
  }

  const { error: revokeError } = await supabase
    .from('user_sessions')
    .update({ revoked_at: changedAt })
    .eq('user_id', account.id)
    .neq('id', identity.id)
    .is('revoked_at', null);

  if (revokeError) {
    logDatabaseError('Self-service password session revocation failed.', revokeError);
    return c.json({
      error: 'Password changed, but other sessions could not be revoked. Contact support.'
    }, 500);
  }

  const { error: auditError } = await supabase.from('audit_logs').insert({
    actor_email: identity.internalEmail,
    action: 'change_own_password',
    target_type: 'user_account',
    target_id: account.id,
    metadata: { username: identity.username }
  });

  if (auditError) {
    logDatabaseError('Self-service password audit logging failed.', auditError);
  }

  return c.json({ changed: true });
});

app.post('/auth/check-access', async (c) => {
  const body = accessSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'A valid email and device identifier are required.' }, 400);
  if (!(await verifyIdentity(c.env, c.req.header('Authorization'), body.data.email))) return c.json({ error: 'Verify this email with OTP before continuing.' }, 401);
  const device = body.data.installationId ? { installationId: body.data.installationId, deviceName: body.data.deviceName, androidVersion: body.data.androidVersion } : undefined;
  const access = await checkAccess(c.env, body.data.email, device);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  return c.json({ approved: true, role: access.role, maxDevices: access.maxDevices, activeDevices: access.activeDevices, subscriptionExpiresAt: access.subscriptionExpiresAt });
});



type CouncilReview = {
  approved: boolean;
  issues: string[];
  fixes: string[];
};

function parseCouncilReview(raw: string): CouncilReview {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');

    if (start < 0 || end <= start) {
      throw new Error('Reviewer JSON missing.');
    }

    const parsed = JSON.parse(
      raw.slice(start, end + 1)
    ) as Record<string, unknown>;

    return {
      approved: parsed.approved === true,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues
            .filter(
              (item): item is string =>
                typeof item === 'string'
            )
            .slice(0, 20)
        : [],
      fixes: Array.isArray(parsed.fixes)
        ? parsed.fixes
            .filter(
              (item): item is string =>
                typeof item === 'string'
            )
            .slice(0, 20)
        : []
    };
  } catch {
    return {
      approved: false,
      issues: ['Reviewer returned invalid structured output.'],
      fixes: [raw.slice(0, 800)]
    };
  }
}

function compactProjectFiles(
  files: GeneratedProjectFile[]
): Array<{ path: string; content: string }> {
  let remaining = 18000;
  const compact: Array<{
    path: string;
    content: string;
  }> = [];

  for (const file of files) {
    if (remaining <= 0) break;

    const content = file.content.slice(
      0,
      Math.min(remaining, 4500)
    );

    compact.push({
      path: file.path,
      content
    });

    remaining -= content.length;
  }

  return compact;
}

type GenerationEventInput = {
  jobId: string;
  email: string;
  eventType: string;
  title: string;
  detail?: string;
  agentName?: string;
  progress: number;
  jobStatus?: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
};

async function recordGenerationEvent(
  supabase: SupabaseClient,
  input: GenerationEventInput
): Promise<void> {
  const now = new Date().toISOString();

  const { error: eventError } = await supabase
    .from('generation_job_events')
    .insert({
      job_id: input.jobId,
      email: input.email,
      event_type: input.eventType,
      agent_name: input.agentName || null,
      status: input.jobStatus || 'info',
      title: input.title,
      detail: input.detail || null,
      progress: input.progress,
      file_path: input.filePath || null,
      metadata: input.metadata || {},
      created_at: now
    });

  if (eventError) {
    console.error('Generation event insert failed:', eventError.message);
  }

  const update: Record<string, unknown> = {
    current_step: input.eventType,
    current_agent: input.agentName || null,
    progress: input.progress,
    updated_at: now
  };

  if (input.jobStatus) {
    update.status = input.jobStatus;
  }

  const { error: updateError } = await supabase
    .from('generation_jobs')
    .update(update)
    .eq('id', input.jobId);

  if (updateError) {
    console.error('Generation job update failed:', updateError.message);
  }
}


app.post('/generation-jobs/start', async (c) => {
  const parsed = z.object({
    email: z.string().email(),
    installationId: z.string().uuid(),
    prompt: z.string().min(20).max(6000),
    image: z.object({
      mimeType: z.string().regex(/^image\//),
      data: z.string().min(20).max(12000000),
      name: z.string().max(180).optional()
    }).optional(),
    generationMode: z.enum(['standard', 'saas-motion']).optional().default('standard'),
    motionBrief: z.string().min(20).max(1800).optional(),
    motionFrameCount: z.number().int().min(4).max(12).optional(),
    motionDurationSeconds: z.number().min(0.1).max(21).optional(),
    thinkMax: thinkMaxFlagSchema
  }).safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({ error: 'A valid website request is required.' }, 400);
  }

  if (parsed.data.generationMode === 'saas-motion' && (!parsed.data.image || !parsed.data.motionBrief)) {
    return c.json({ error: 'SaaS Motion Mode requires extracted animation frames and a motion brief.' }, 400);
  }

  const email = parsed.data.email.toLowerCase();
  const access = await requireUser(
    c,
    email,
    parsed.data.installationId
  );

  if (!access) {
    return c.json({
      error: 'Your login session is missing or expired.'
    }, 401);
  }

  if (!access.ok) {
    return c.json({ error: access.error }, access.status);
  }

  const supabase = requireSupabase(c.env);
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('generation_jobs')
    .insert({
      id: jobId,
      email,
      prompt: parsed.data.prompt,
      status: 'queued',
      current_step: 'request_received',
      current_agent: 'Orchestrator',
      progress: 2,
      workflow_mode:
        parsed.data.generationMode === 'saas-motion'
          ? parsed.data.thinkMax === true
            ? 'saas-motion-thinkmax'
            : 'saas-motion'
          : parsed.data.thinkMax === true
            ? 'thinkmax'
            : 'auto',
      started_at: now,
      updated_at: now
    });

  if (error) {
    console.error('Job creation failed:', error.message);

    return c.json({
      error: 'Could not start the generation job.'
    }, 500);
  }

  await recordGenerationEvent(supabase, {
    jobId,
    email,
    eventType: 'request_received',
    agentName: 'Orchestrator',
    title: 'Request received',
    detail: 'Nexora.Ai received the website instructions.',
    progress: 2,
    jobStatus: 'queued'
  });

  return c.json({
    jobId,
    status: 'queued',
    progress: 2
  }, 202);
});

app.get('/generation-jobs/:id', async (c) => {
  const parsed = z.object({
    email: z.string().email(),
    installationId: z.string().uuid()
  }).safeParse({
    email: c.req.query('email'),
    installationId: c.req.header('X-Device-Id')
  });

  if (!parsed.success) {
    return c.json({
      error: 'Email and device identifier are required.'
    }, 400);
  }

  const email = parsed.data.email.toLowerCase();
  const access = await requireUser(
    c,
    email,
    parsed.data.installationId
  );

  if (!access) {
    return c.json({
      error: 'Your login session is missing or expired.'
    }, 401);
  }

  if (!access.ok) {
    return c.json({ error: access.error }, access.status);
  }

  const supabase = requireSupabase(c.env);

  const { data: job, error: jobError } = await supabase
    .from('generation_jobs')
    .select(
      'id,project_id,status,current_step,current_agent,progress,workflow_mode,agent_states,error_message,created_at,started_at,updated_at,completed_at'
    )
    .eq('id', c.req.param('id'))
    .eq('email', email)
    .maybeSingle();

  if (jobError || !job) {
    return c.json({ error: 'Generation job not found.' }, 404);
  }

  const normalizedStatus = String(job.status || '').toLowerCase();
  const updatedAt = Date.parse(String(job.updated_at || ''));
  const inactiveFor = Number.isFinite(updatedAt)
    ? Date.now() - updatedAt
    : 0;
  const staleAfter = normalizedStatus === 'queued'
    ? 2 * 60 * 1000
    : normalizedStatus === 'running'
      ? 10 * 60 * 1000
      : null;

  if (staleAfter !== null && inactiveFor > staleAfter) {
    const failure = normalizedStatus === 'queued'
      ? 'The generation worker could not start. Please retry the build.'
      : `Generation stopped responding during ${job.current_step || 'processing'}. Please retry the build.`;
    const completedAt = new Date().toISOString();

    const { data: failedJob } = await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        current_step: 'failed',
        current_agent: null,
        progress: 100,
        error_message: failure,
        completed_at: completedAt,
        updated_at: completedAt
      })
      .eq('id', job.id)
      .eq('email', email)
      .in('status', ['queued', 'running'])
      .select(
        'id,project_id,status,current_step,current_agent,progress,workflow_mode,agent_states,error_message,created_at,started_at,updated_at,completed_at'
      )
      .maybeSingle();

    if (failedJob) Object.assign(job, failedJob);
  }

  const { data: events, error: eventsError } = await supabase
    .from('generation_job_events')
    .select(
      'id,event_type,agent_name,status,title,detail,progress,file_path,metadata,created_at'
    )
    .eq('job_id', job.id)
    .eq('email', email)
    .order('created_at', { ascending: true });

  if (eventsError) {
    console.error('Job event query failed:', eventsError.message);
  }

  return c.json({
    job,
    events: events || []
  });
});

app.post('/generate', async (c) => {
  const parsed = z.object({
    email: z.string().email(),
    installationId: z.string().uuid(),
    prompt: z.string().min(20).max(6000),
    jobId: z.string().uuid().optional(),
    image: z.object({
      mimeType: z.string().regex(/^image\//),
      data: z.string().min(20).max(12000000),
      name: z.string().max(180).optional()
    }).optional(),
    generationMode: z.enum(['standard', 'saas-motion']).optional().default('standard'),
    motionBrief: z.string().min(20).max(1800).optional(),
    motionFrameCount: z.number().int().min(4).max(12).optional(),
    motionDurationSeconds: z.number().min(0.1).max(21).optional(),
    thinkMax: thinkMaxFlagSchema
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Email, device identifier and a detailed website prompt are required.' }, 400);

  if (parsed.data.generationMode === 'saas-motion' && (!parsed.data.image || !parsed.data.motionBrief)) {
    return c.json({ error: 'SaaS Motion Mode requires extracted animation frames and a motion brief.' }, 400);
  }

  const email = parsed.data.email.toLowerCase();
  const access = await requireUser(c, email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const supabase = requireSupabase(c.env);
  const projectId = crypto.randomUUID();
  const jobId = parsed.data.jobId || crypto.randomUUID();

  if (parsed.data.jobId) {
    const { data: existingJob, error: existingJobError } =
      await supabase
        .from('generation_jobs')
        .select('id')
        .eq('id', jobId)
        .eq('email', email)
        .maybeSingle();

    if (existingJobError || !existingJob) {
      return c.json({ error: 'Generation job not found.' }, 404);
    }

    const { data: startedJob, error: startError } = await supabase
      .from('generation_jobs')
      .update({
        status: 'running',
        current_step: 'planning',
        current_agent: 'Planner',
        progress: 8,
        started_at: new Date().toISOString()
      })
      .eq('id', jobId)
      .eq('email', email)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();

    if (startError) {
      return c.json({ error: 'Could not start generation.' }, 500);
    }

    if (!startedJob) {
      return c.json({
        error: 'Generation job is already running or completed.'
      }, 409);
    }
  } else {
    const { error: jobError } = await supabase
      .from('generation_jobs')
      .insert({
        id: jobId,
        email,
        prompt: parsed.data.prompt,
        status: 'running',
        current_step: 'planning',
        current_agent: 'Planner',
        progress: 8,
        workflow_mode:
          parsed.data.generationMode === 'saas-motion'
            ? parsed.data.thinkMax === true
              ? 'saas-motion-thinkmax'
              : 'saas-motion'
            : parsed.data.thinkMax === true
              ? 'thinkmax'
              : 'auto',
        started_at: new Date().toISOString()
      });

    if (jobError) {
      return c.json({
        error: 'Could not start the generation job.'
      }, 500);
    }
  }

  let generationReservationId: string | null = null;

  try {
    const generationCost =
      await getNexoraOperationCost(supabase, 'website_generation', 100) +
      (parsed.data.image
        ? await getNexoraOperationCost(supabase, 'image_analysis', 15)
        : 0) +
      (parsed.data.generationMode === 'saas-motion'
        ? await getNexoraOperationCost(supabase, 'saas_motion_analysis', 45)
        : 0);

    const reservation = await reserveNexoraTokens(
      supabase,
      email,
      generationCost,
      'website_generation',
      jobId,
      parsed.data.generationMode === 'saas-motion'
        ? 'SaaS Motion website generation with keyframe analysis'
        : parsed.data.image
          ? 'Website generation with image analysis'
          : 'Complete website generation'
    );

    generationReservationId = reservation.reservationId;
  } catch (tokenError) {
    const message = tokenError instanceof Error
      ? tokenError.message
      : 'Could not reserve Nexora Tokens.';

    await supabase.from('generation_jobs').update({
      status: 'failed',
      current_step: 'token_check_failed',
      error_message: message,
      completed_at: new Date().toISOString()
    }).eq('id', jobId);

    return c.json(
      { error: message },
      (tokenError instanceof NexoraTokenError ? tokenError.status : 500) as any
    );
  }

  try {
    if (parsed.data.generationMode === 'saas-motion') {
      await recordGenerationEvent(supabase, {
        jobId,
        email,
        eventType: 'motion_reference_ready',
        agentName: 'Motion Director',
        title: 'Animation reference prepared',
        detail: `Analysing ${parsed.data.motionFrameCount || 6} keyframes from a ${parsed.data.motionDurationSeconds?.toFixed(1) || 'short'} second reference.`,
        progress: 10,
        jobStatus: 'running',
        metadata: { frameCount: parsed.data.motionFrameCount || 6, durationSeconds: parsed.data.motionDurationSeconds || null, extraTokenCost: 45 }
      });
    }

    await recordGenerationEvent(supabase, {
      jobId,
      email,
      eventType: 'planning',
      agentName: 'Planner',
      title: 'Planning website',
      detail: 'Analysing requirements, pages, features and design direction.',
      progress: 12,
      jobStatus: 'running'
    });

    const planResult = await buildWebsitePlan((parsed.data.prompt + '\n\n' + buildFullStackInstruction(parsed.data.prompt)), {
      apiKey: c.env.GEMINI_API_KEY,
      model: c.env.GEMINI_MODEL,
      image: parsed.data.image
        ? {
            mimeType: parsed.data.image.mimeType,
            data: parsed.data.image.data
          }
        : undefined
    });

    await recordGenerationEvent(supabase, {
      jobId,
      email,
      eventType: 'plan_completed',
      agentName: 'Planner',
      title: 'Project plan completed',
      detail: `${planResult.plan.businessName} • ${planResult.plan.websiteType}`,
      progress: 32,
      jobStatus: 'running'
    });

    if (
      parsed.data.thinkMax === true &&
      (!c.env.GROQ_API_KEY || !c.env.GROQ_CODER_MODEL)
    ) {
      throw new Error(
        'ThinkMax is unavailable because advanced planning is not configured.'
      );
    }

    if (parsed.data.thinkMax === true) {
      await recordGenerationEvent(supabase, {
        jobId,
        email,
        eventType: 'thinkmax_refinement_started',
        agentName: 'ThinkMax',
        title: 'ThinkMax is refining the project plan',
        detail:
          'Reviewing requirements, architecture and implementation priorities.',
        progress: 34,
        jobStatus: 'running'
      });
    }

    const thinkMaxResult = await runOptionalThinkMax(
      parsed.data.thinkMax === true,
      {
        request:
          parsed.data.prompt +
          '\n\n' +
          buildFullStackInstruction(parsed.data.prompt),
        plan: planResult.plan
      },
      (input) => runThinkMaxPlanningAgent(c.env, input)
    );
    const generationPlan = thinkMaxResult.plan;

    if (thinkMaxResult.completed) {
      await recordGenerationEvent(supabase, {
        jobId,
        email,
        eventType: 'thinkmax_refinement_completed',
        agentName: 'ThinkMax',
        title: 'ThinkMax refinement completed',
        detail:
          'The refined plan passed structured validation and is ready for implementation.',
        progress: 38,
        jobStatus: 'running',
        metadata: {
          sectionCount: generationPlan.sections.length,
          featureCount: generationPlan.features.length
        }
      });
    }

    const { error: projectError } = await supabase.from('projects').insert({ id: projectId, email, name: generationPlan.businessName, description: parsed.data.prompt, website_type: generationPlan.websiteType, status: 'building', plan: generationPlan, framework: 'vite-react' });
    if (projectError) throw new Error('Could not save the generated project.');

    let formPublicKey: string | undefined;
    if (generationPlan.features.includes('contact-form')) {
      const { data: form, error: formError } = await supabase.from('website_forms').insert({ project_id: projectId, name: 'Contact form' }).select('public_key').single();
      if (formError) throw new Error('Could not create the website contact form.');
      formPublicKey = String(form.public_key);
    }

    let codingBrief = '';

    if (
      c.env.GROQ_API_KEY &&
      c.env.GROQ_CODER_MODEL
    ) {
      await recordGenerationEvent(supabase, {
        jobId,
        email,
        eventType: 'coder_started',
        agentName: 'Groq Coder',
        title: 'Coder analysing project plan',
        detail:
          'Preparing component architecture and implementation instructions.',
        progress: 39,
        jobStatus: 'running'
      });

      try {
        codingBrief = await runCodingAgent(
          c.env,
          JSON.stringify({
            task: [
              'Create improved project files as strict JSON.',
              'Return only files that need replacing.',
              'Use only allowed paths.',
              'Match the plan, screenshot reference, mobile layout,',
              'accessibility and requested interactions.'
            ].join(' '),
            request:
            parsed.data.prompt +
            '\n\n' +
            buildFullStackInstruction(
              parsed.data.prompt
            ),
            plan: generationPlan,
            thinkMaxArchitectureBrief:
              thinkMaxResult.architectureBrief || undefined
          })
        );

        await recordGenerationEvent(supabase, {
          jobId,
          email,
          eventType: 'coder_completed',
          agentName: 'Groq Coder',
          title: 'Implementation specification ready',
          detail:
            'The coding agent completed the project architecture.',
          progress: 45,
          jobStatus: 'running',
          metadata: {
            provider: 'groq',
            outputPreview: codingBrief.slice(0, 1000)
          }
        });
      } catch (coderError) {
        await recordGenerationEvent(supabase, {
          jobId,
          email,
          eventType: 'coder_fallback',
          agentName: 'Nexora.Ai Builder',
          title: 'Coder fallback activated',
          detail:
            coderError instanceof Error
              ? coderError.message
              : 'Groq Coder was unavailable.',
          progress: 45,
          jobStatus: 'running'
        });
      }
    }

    await recordGenerationEvent(supabase, {
      jobId,
      email,
      eventType: 'coding',
      agentName: 'Builder',
      title: 'Building React project',
      detail: 'Creating components, styles, pages and project files.',
      progress: 48,
      jobStatus: 'running'
    });

    let generated = buildProjectFiles(generationPlan, {
      formApiBase: publicApiBase(c),
      formPublicKey
    });

    if (codingBrief) {
      try {
        const codingPatch =
          parseCouncilProjectPatch(codingBrief);

        generated = applyCouncilProjectPatch(
          generated,
          codingPatch
        );

        await recordGenerationEvent(supabase, {
          jobId,
          email,
          eventType: 'coder_changes_applied',
          agentName: 'Groq Coder',
          title: 'Coder changes applied',
          detail:
            `${codingPatch.files.length} generated file(s) were upgraded.`,
          progress: 69,
          jobStatus: 'running',
          metadata: {
            files: codingPatch.files.map(
              (file) => file.path
            ),
            summary: codingPatch.summary || null
          }
        });
      } catch (patchError) {
        await recordGenerationEvent(supabase, {
          jobId,
          email,
          eventType: 'coder_patch_rejected',
          agentName: 'Code Validator',
          title: 'Unsafe coder output rejected',
          detail:
            patchError instanceof Error
              ? patchError.message
              : 'Coder output could not be applied.',
          progress: 69,
          jobStatus: 'running'
        });
      }
    }

    await recordGenerationEvent(supabase, {
      jobId,
      email,
      eventType: 'files_created',
      agentName: 'Builder',
      title: 'Project files created',
      detail: `${generated.files.length} files generated.`,
      progress: 72,
      jobStatus: 'running',
      metadata: { fileCount: generated.files.length }
    });
    await recordGenerationEvent(supabase, {
      jobId,
      email,
      eventType: 'deterministic_validation_started',
      agentName: 'Code Validator',
      title: 'Running deterministic code checks',
      detail:
        'Checking files, React entry points, build configuration, responsive CSS and embedded secrets.',
      progress: 75,
      jobStatus: 'running'
    });

    generated.files = ensureFullStackArtifacts(
      parsed.data.prompt,
      generated.files
    );

    const deterministicValidation =
      validateGeneratedProject(
        generated.files,
        parsed.data.prompt
      );

    await recordGenerationEvent(supabase, {
      jobId,
      email,
      eventType: deterministicValidation.passed
        ? 'deterministic_validation_passed'
        : 'deterministic_validation_failed',
      agentName: 'Code Validator',
      title: deterministicValidation.passed
        ? 'Deterministic validation passed'
        : 'Deterministic validation failed',
      detail: deterministicValidation.passed
        ? 'All required project structure and safety checks passed.'
        : deterministicValidation.errors.join(' | ').slice(0, 1200),
      progress: 77,
      jobStatus: 'running',
      metadata: {
        checks: deterministicValidation.checks,
        errors: deterministicValidation.errors,
        warnings: deterministicValidation.warnings
      }
    });

    if (!deterministicValidation.passed) {
      throw new Error(
        `Code validation failed: ${
          deterministicValidation.errors.join('; ')
        }`
      );
    }

    if (
      c.env.GROQ_API_KEY &&
      c.env.GROQ_REVIEWER_MODEL
    ) {
      await recordGenerationEvent(supabase, {
        jobId,
        email,
        eventType: 'review_started',
        agentName: 'Groq Reviewer',
        title: 'Reviewer checking generated project',
        detail:
          'Inspecting React files, imports, accessibility and mobile layout.',
        progress: 78,
        jobStatus: 'running'
      });

      try {
        const reviewerOutput = await runReviewerAgent(
          c.env,
          JSON.stringify({
            task: [
              'Review this generated React project.',
              'Return strict JSON:',
              '{"approved":boolean,"issues":string[],"fixes":string[]}.'
            ].join(' '),
            request:
            parsed.data.prompt +
            '\n\n' +
            buildFullStackInstruction(
              parsed.data.prompt
            ),
            plan: generationPlan,
            codingBrief,
            files: compactProjectFiles(generated.files)
          })
        );

        const review = parseCouncilReview(
          reviewerOutput
        );

        await recordGenerationEvent(supabase, {
          jobId,
          email,
          eventType: review.approved
            ? 'review_approved'
            : 'review_issues_found',
          agentName: 'Groq Reviewer',
          title: review.approved
            ? 'Independent review passed'
            : 'Reviewer found issues',
          detail: review.approved
            ? 'No blocking problems were reported.'
            : `${review.issues.length} issue(s) require repair.`,
          progress: 84,
          jobStatus: 'running',
          metadata: {
            approved: review.approved,
            issues: review.issues,
            fixes: review.fixes
          }
        });

        if (!review.approved) {
          if (
            !c.env.AI ||
            !c.env.CLOUDFLARE_REPAIR_MODEL
          ) {
            throw new Error(
              'Repair validation failed: reviewer found issues but the repair agent is unavailable.'
            );
          }

          await recordGenerationEvent(supabase, {
            jobId,
            email,
            eventType: 'repair_started',
            agentName: 'Cloudflare Repair',
            title: 'Repair agent working',
            detail:
              'Correcting the reviewer findings in the project files.',
            progress: 87,
            jobStatus: 'running'
          });

          let repairOutput: string;

          try {
            repairOutput = await runRepairAgent(
              c.env,
              JSON.stringify({
                task: [
                  'Return strict JSON containing corrected files.',
                  'Use only the allowed file paths.',
                  'Fix every reviewer issue without breaking',
                  'working project behaviour.'
                ].join(' '),
                review,
                files: compactProjectFiles(generated.files)
              })
            );
          } catch (repairError) {
            throw new Error(
              `Repair validation failed: ${
                repairError instanceof Error
                  ? repairError.message
                  : 'Repair agent failed.'
              }`
            );
          }

          const repairPatch =
            parseCouncilProjectPatch(repairOutput);

          generated = applyCouncilProjectPatch(
            generated,
            repairPatch
          );
        generated.files = ensureFullStackArtifacts(
          parsed.data.prompt,
          generated.files
        );


          const repairedValidation =
            validateGeneratedProject(
        generated.files,
        parsed.data.prompt
      );

          if (!repairedValidation.passed) {
            throw new Error(
              `Repair validation failed: ${
                repairedValidation.errors.join('; ')
              }`
            );
          }

          await recordGenerationEvent(supabase, {
            jobId,
            email,
            eventType: 'final_review_started',
            agentName: 'Groq Reviewer',
            title: 'Running final independent review',
            detail:
              'Rechecking repaired files before the project is saved.',
            progress: 92,
            jobStatus: 'running'
          });

          const finalReviewOutput =
            await runReviewerAgent(
              c.env,
              JSON.stringify({
                task: [
                  'Perform the final review of this repaired React project.',
                  'Return strict JSON:',
                  '{"approved":boolean,"issues":string[],"fixes":string[]}.',
                  'Approve only when there are no blocking errors.'
                ].join(' '),
                request:
            parsed.data.prompt +
            '\n\n' +
            buildFullStackInstruction(
              parsed.data.prompt
            ),
                plan: generationPlan,
                files: compactProjectFiles(generated.files)
              })
            );

          const finalReview =
            parseCouncilReview(finalReviewOutput);

          if (!finalReview.approved) {
            throw new Error(
              `Repair validation failed: final reviewer rejected the project: ${
                finalReview.issues.join('; ') ||
                'Unknown reviewer issue.'
              }`
            );
          }

await recordGenerationEvent(supabase, {
            jobId,
            email,
            eventType: 'final_review_passed',
            agentName: 'Groq Reviewer',
            title: 'Final independent review passed',
            detail:
              'The repaired project passed both code validation and AI review.',
            progress: 94,
            jobStatus: 'running',
            metadata: {
              issues: finalReview.issues,
              fixes: finalReview.fixes
            }
          });

          await recordGenerationEvent(supabase, {
            jobId,
            email,
            eventType: 'repair_completed',
            agentName: 'Cloudflare Repair',
            title: 'Project repaired and validated',
            detail:
              `${repairPatch.files.length} corrected file(s) passed validation.`,
            progress: 90,
            jobStatus: 'running',
            metadata: {
              files: repairPatch.files.map(
                (file) => file.path
              ),
              checks: repairedValidation.checks
            }
          });
        }
      } catch (reviewError) {
        if (
          reviewError instanceof Error &&
          reviewError.message.startsWith(
            'Repair validation failed:'
          )
        ) {
          throw reviewError;
        }

        await recordGenerationEvent(supabase, {
          jobId,
          email,
          eventType: 'review_fallback',
          agentName: 'Nexora.Ai Validator',
          title: 'Reviewer fallback activated',
          detail:
            reviewError instanceof Error
              ? reviewError.message
              : 'Independent reviewer was unavailable.',
          progress: 86,
          jobStatus: 'running'
        });
      }
    }

    const { error: versionError } = await supabase.from('project_versions').insert({
      full_stack_report: createFullStackReport(
        parsed.data.prompt,
        generated.files
      ),
      project_id: projectId,
      version_number: 1,
      prompt: parsed.data.prompt,
      plan: generationPlan,
      generated_files: generated.files,
      preview_html: generated.previewHtml
    });
    if (versionError) throw new Error('Could not save the first project version.');

    const completedAt = new Date().toISOString();

    const { error: projectReadyError } = await supabase
      .from('projects')
      .update({ status: 'preview_ready' })
      .eq('id', projectId)
      .eq('email', email);

    if (projectReadyError) {
      throw new Error('Could not prepare the website preview.');
    }

    const { error: completedJobError } = await supabase
      .from('generation_jobs')
      .update({
        project_id: projectId,
        status: 'completed',
        current_step: 'preview_ready',
        current_agent: null,
        progress: 100,
        output_plan: generationPlan,
        error_message: null,
        completed_at: completedAt,
        updated_at: completedAt
      })
      .eq('id', jobId)
      .eq('email', email);

    if (completedJobError) {
      throw new Error('Could not finalize the generated website.');
    }

    await finalizeNexoraTokens(supabase, generationReservationId);

    await recordGenerationEvent(supabase, {
      jobId,
      email,
      eventType: 'completed',
      agentName: 'Nexora.Ai Council',
      title: 'Website ready',
      detail: 'The React project and preview are ready.',
      progress: 100,
      jobStatus: 'completed',
      metadata: {
        projectId,
        thinkMaxCompleted: thinkMaxResult.completed
      }
    });

const fullStackReport = createFullStackReport(
  parsed.data.prompt,
  generated.files
);

return c.json({
      fullStackReport, projectId, jobId, plan: generationPlan, previewHtml: generated.previewHtml, framework: generated.framework, fileCount: generated.files.length, mode: planResult.mode, thinkMaxCompleted: thinkMaxResult.completed });
  } catch (error) {
    const failureMessage =
      error instanceof Error ? error.message : 'Generation failed';

    await refundNexoraTokens(
      supabase,
      generationReservationId,
      failureMessage
    );

    await recordGenerationEvent(supabase, {
      jobId,
      email,
      eventType: 'failed',
      agentName: 'Nexora.Ai Council',
      title: 'Generation failed',
      detail: failureMessage,
      progress: 100,
      jobStatus: 'failed'
    });

    await supabase.from('generation_jobs').update({
      status: 'failed',
      current_step: 'failed',
      current_agent: null,
      error_message: failureMessage,
      completed_at: new Date().toISOString()
    }).eq('id', jobId);
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
  const [{ data: latest }, { data: origin }] = await Promise.all([
    supabase.from('project_versions').select('version_number,plan,prompt,generated_files').eq('project_id', projectId).order('version_number', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('project_versions').select('prompt').eq('project_id', projectId).order('version_number', { ascending: true }).limit(1).maybeSingle()
  ]);
  if (!latest) return c.json({ error: 'Project version not found.' }, 404);

  let editReservationId: string | null = null;

  try {
    const editCost = await getNexoraOperationCost(
      supabase,
      'website_edit',
      60
    );
    editReservationId = (await reserveNexoraTokens(
      supabase,
      parsed.data.email.toLowerCase(),
      editCost,
      'website_edit',
      projectId,
      'Website edit or redesign'
    )).reservationId;
  } catch (tokenError) {
    return c.json(
      { error: tokenError instanceof Error ? tokenError.message : 'Could not reserve Nexora Tokens.' },
      (tokenError instanceof NexoraTokenError ? tokenError.status : 500) as any
    );
  }

  try {
    const revised = await reviseWebsitePlan(latest.plan as WebsitePlan, parsed.data.instruction, { apiKey: c.env.GEMINI_API_KEY, model: c.env.GEMINI_MODEL });
    let { data: form } = await supabase.from('website_forms').select('public_key').eq('project_id', projectId).eq('active', true).maybeSingle();
    if (!form && revised.plan.features.includes('contact-form')) {
      const created = await supabase.from('website_forms').insert({ project_id: projectId, name: 'Contact form' }).select('public_key').single();
      if (created.error) throw new Error('Could not create the website contact form.');
      form = created.data;
    }
    const generated = buildProjectFiles(revised.plan, { formApiBase: publicApiBase(c), formPublicKey: form?.public_key ? String(form.public_key) : undefined });
    const previousFiles = Array.isArray(latest.generated_files)
      ? latest.generated_files.filter((item): item is GeneratedProjectFile => {
          if (!item || typeof item !== 'object') return false;
          const file = item as Record<string, unknown>;
          return (
            typeof file.path === 'string' &&
            typeof file.content === 'string' &&
            file.path.length > 0 &&
            !file.path.startsWith('/') &&
            !file.path.includes('..') &&
            !file.path.includes('\\')
          );
        })
      : [];
    const regeneratedPaths = new Set(
      generated.files.map((file) => file.path)
    );
    generated.files = [
      ...generated.files,
      ...previousFiles.filter(
        (file) => !regeneratedPaths.has(file.path)
      )
    ];
    const validationRequest = [
      String(origin?.prompt || latest.prompt || ''),
      parsed.data.instruction
    ].filter(Boolean).join('\n\n');
    generated.files = ensureFullStackArtifacts(
      validationRequest,
      generated.files
    );
    const validation = validateGeneratedProject(
      generated.files,
      validationRequest
    );
    if (!validation.passed) {
      throw new Error(
        `Edited project failed validation: ${validation.errors.join('; ')}`
      );
    }
    const securityAudit = auditGeneratedSecurity(
      generated.files
    );
    if (!securityAudit.passed) {
      throw new Error(
        'Edited project failed the security verification gate.'
      );
    }
    const versionNumber = Number(latest.version_number) + 1;
    const { error } = await supabase.from('project_versions').insert({
      full_stack_report: createFullStackReport(
        validationRequest,
        generated.files
      ), project_id: projectId, version_number: versionNumber, prompt: parsed.data.instruction, plan: revised.plan, generated_files: generated.files, preview_html: generated.previewHtml });
    if (error) throw new Error('Could not save the edited version.');
    await supabase.from('projects').update({ plan: revised.plan, name: revised.plan.businessName, website_type: revised.plan.websiteType, status: 'preview_ready', production_url: null }).eq('id', projectId);
    await finalizeNexoraTokens(supabase, editReservationId);
    return c.json({ projectId, versionNumber, plan: revised.plan, previewHtml: generated.previewHtml, framework: generated.framework, fileCount: generated.files.length, mode: revised.mode });
  } catch (error) {
    await refundNexoraTokens(
      supabase,
      editReservationId,
      error instanceof Error ? error.message : 'Website edit failed'
    );
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
  const { data, error } = await supabase
    .from('projects')
    .select('id,name,website_type,status,framework,created_at,updated_at')
    .eq('email', parsed.data.email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Project list query failed:', error.message);
    return c.json({ error: 'Could not load projects.' }, 500);
  }

  return c.json({
    projects: (data || []).map((project) => ({
      ...project,
      github_repository: null,
      production_url: null,
      deployment_state: null
    }))
  });
});

app.get('/projects/:id', async (c) => {
  const parsed = z.object({ email: z.string().email(), installationId: z.string().uuid() }).safeParse({ email: c.req.query('email'), installationId: c.req.header('X-Device-Id') });
  if (!parsed.success) return c.json({ error: 'Email and device identifier are required.' }, 400);
  const access = await requireUser(c, parsed.data.email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  const supabase = requireSupabase(c.env);
  const { data: project } = await supabase.from('projects').select('*').eq('id', c.req.param('id')).eq('email', parsed.data.email.toLowerCase()).maybeSingle();
  if (!project) return c.json({ error: 'Project not found.' }, 404);
  const { data: version } = await supabase.from('project_versions').select('version_number,plan,preview_html,created_at,full_stack_report,generated_files').eq('project_id', project.id).order('version_number', { ascending: false }).limit(1).maybeSingle();
  const generatedFiles = Array.isArray(version?.generated_files)
    ? version.generated_files.filter((item): item is GeneratedProjectFile => {
        if (!item || typeof item !== 'object') return false;
        const file = item as Record<string, unknown>;
        return typeof file.path === 'string' && typeof file.content === 'string';
      })
    : [];
  const safeVersion = version
    ? {
        version_number: version.version_number,
        plan: version.plan,
        preview_html: version.preview_html,
        created_at: version.created_at,
        full_stack_report: version.full_stack_report,
        file_count: generatedFiles.length,
        file_paths: generatedFiles.map((file) => file.path).slice(0, 200)
      }
    : null;
  return c.json({ project, version: safeVersion });
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

  let publishReservationId: string | null = null;

  try {
    await supabase.from('projects').update({ status: 'publishing', deployment_state: 'PUBLISHING' }).eq('id', projectId);
    const github = await getConnection(supabase, c.env, parsed.data.email, 'github');
    const vercel = await getConnection(supabase, c.env, parsed.data.email, 'vercel');
    if (!github.external_account_name) throw new Error('Reconnect GitHub so the account username can be verified.');
    const files = version.generated_files as GeneratedProjectFile[];
    const { data: cmsSettings } = await supabase
      .from('cms_settings')
      .select('public_slug')
      .eq('project_id', projectId)
      .eq('enabled', true)
      .maybeSingle();

    const securityAudit =
      auditGeneratedSecurity(files);

    if (!securityAudit.passed) {
      const repairGuidance =
        securityAuditRepairGuidance(securityAudit);

      await supabase.from('projects').update({
        status: 'publish_failed',
        deployment_state: 'AUDIT_BLOCKED'
      }).eq('id', projectId);

      return c.json(
        {
          error:
            'Publishing was blocked by the security audit. Fix the listed issues and retry.',
          code: 'SECURITY_AUDIT_FAILED',
          errors: securityAudit.errors,
          warnings: securityAudit.warnings,
          repairGuidance,
          securityAudit
        },
        422
      );
    }

    const publishCost = await getNexoraOperationCost(
      supabase,
      'publish',
      20
    );
    publishReservationId = (await reserveNexoraTokens(
      supabase,
      parsed.data.email.toLowerCase(),
      publishCost,
      'publish',
      projectId,
      'Publish website'
    )).reservationId;

    const deployFiles = cmsSettings?.public_slug
      ? injectCmsRuntime(
          files,
          new URL(c.req.url).origin,
          cmsSettings.public_slug
        )
      : files;
    const repository = await pushToGitHub(github.accessToken, github.external_account_name, project.name, deployFiles);
    const deployment = await deployToVercel(vercel, `${projectSlug(project.plan as WebsitePlan)}-${projectId.slice(0, 6)}`, deployFiles, project.vercel_project_id);
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
    await finalizeNexoraTokens(supabase, publishReservationId);
    return c.json({ projectId, githubRepository: repository.url, productionUrl: deployment.deploymentUrl, deploymentId: deployment.deploymentId, state: deployment.readyState, securityAudit });
  } catch (error) {
    await refundNexoraTokens(
      supabase,
      publishReservationId,
      error instanceof Error ? error.message : 'Publishing failed'
    );
    await supabase.from('projects').update({ status: 'publish_failed', deployment_state: 'ERROR' }).eq('id', projectId);
    return c.json({ error: error instanceof Error ? error.message : 'Publishing failed.' }, 500);
  }
});


app.get('/projects/:id/source', async (c) => {
  const parsed = z.object({
    projectId: z.string().uuid(),
    email: z.string().email(),
    installationId: z.string().uuid()
  }).safeParse({
    projectId: c.req.param('id'),
    email: c.req.query('email'),
    installationId: c.req.header('X-Device-Id')
  });

  if (!parsed.success) {
    return c.json({
      error: 'Valid project, email and device identifiers are required.'
    }, 400);
  }

  const email = parsed.data.email.toLowerCase();

  const access = await requireUser(
    c,
    email,
    parsed.data.installationId
  );

  if (!access) {
    return c.json({
      error: 'Your login session is missing or expired.'
    }, 401);
  }

  if (!access.ok) {
    return c.json({
      error: access.error
    }, access.status);
  }

  const supabase = requireSupabase(c.env);

  const { data: project, error: projectError } =
    await supabase
      .from('projects')
      .select('id,name,email')
      .eq('id', parsed.data.projectId)
      .eq('email', email)
      .maybeSingle();

  if (projectError || !project) {
    return c.json({
      error: 'Project was not found.'
    }, 404);
  }

  const { data: version, error: versionError } =
    await supabase
      .from('project_versions')
      .select('generated_files,version_number')
      .eq('project_id', project.id)
      .order('version_number', {
        ascending: false
      })
      .limit(1)
      .maybeSingle();

  if (versionError || !version) {
    return c.json({
      error: 'Project source files are unavailable.'
    }, 404);
  }

  const rawFiles = Array.isArray(
    version.generated_files
  )
    ? version.generated_files
    : [];

  const files = rawFiles
    .filter((item): item is {
      path: string;
      content: string;
    } => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const file = item as Record<string, unknown>;

      return (
        typeof file.path === 'string' &&
        typeof file.content === 'string' &&
        file.path.length > 0 &&
        !file.path.startsWith('/') &&
        !file.path.includes('..') &&
        !file.path.includes('\\')
      );
    })
    .slice(0, 200);

  const totalCharacters = files.reduce(
    (total, file) =>
      total + file.path.length + file.content.length,
    0
  );

  if (!files.length) {
    return c.json({
      error: 'No downloadable source files were found.'
    }, 404);
  }

  if (totalCharacters > 5000000) {
    return c.json({
      error: 'Project source is too large to download.'
    }, 413);
  }

  return c.json({
    projectId: project.id,
    projectName: project.name || 'nexora-project',
    versionNumber: Number(
      version.version_number || 1
    ),
    files
  });
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



app.get('/usage', async (c) => {
  const parsed = z.object({
    email: z.string().email(),
    installationId: z.string().uuid()
  }).safeParse({
    email: c.req.query('email'),
    installationId: c.req.header('X-Device-Id')
  });

  if (!parsed.success) {
    return c.json({
      error: 'Email and device identifier are required.'
    }, 400);
  }

  const email = parsed.data.email.toLowerCase();

  const access = await requireUser(
    c,
    email,
    parsed.data.installationId
  );

  if (!access) {
    return c.json({
      error: 'Your login session is missing or expired.'
    }, 401);
  }

  if (!access.ok) {
    return c.json({
      error: access.error
    }, access.status);
  }

  const supabase = requireSupabase(c.env);

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const resetAt = new Date(start);
  resetAt.setUTCDate(resetAt.getUTCDate() + 1);

  const [{ data: user }, { count, error: usageError }] =
    await Promise.all([
      supabase
        .from('approved_users')
        .select('daily_website_limit')
        .eq('email', email)
        .maybeSingle(),

      supabase
        .from('generation_jobs')
        .select('id', {
          count: 'exact',
          head: true
        })
        .eq('email', email)
        .gte('created_at', start.toISOString())
    ]);

  if (usageError) {
    return c.json({
      error: 'Could not load daily usage.'
    }, 500);
  }

  const used = count || 0;
  const unlimited = access.role === 'admin';
  const limit = Math.max(
    1,
    Number(user?.daily_website_limit || 1)
  );

  return c.json({
    used,
    limit,
    unlimited,
    remaining: unlimited
      ? null
      : Math.max(0, limit - used),
    percentage: unlimited
      ? 0
      : Math.min(
          100,
          Math.round((used / limit) * 100)
        ),
    resetAt: resetAt.toISOString()
  });
});

app.get('/analytics', async (c) => {
  const parsed = z.object({
    email: z.string().email(),
    installationId: z.string().uuid()
  }).safeParse({
    email: c.req.query('email'),
    installationId: c.req.header('X-Device-Id')
  });

  if (!parsed.success) {
    return c.json({
      error: 'Email and device identifier are required.'
    }, 400);
  }

  const email = parsed.data.email.toLowerCase();

  const access = await requireUser(
    c,
    email,
    parsed.data.installationId
  );

  if (!access) {
    return c.json({
      error: 'Your login session is missing or expired.'
    }, 401);
  }

  if (!access.ok) {
    return c.json({
      error: access.error
    }, access.status);
  }

  const supabase = requireSupabase(c.env);

  const [
    projectsResult,
    jobsResult,
    formsResult
  ] = await Promise.all([
    supabase
      .from('projects')
      .select(
        'id,name,website_type,status,production_url,created_at'
      )
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(500),

    supabase
      .from('generation_jobs')
      .select('id,status,created_at')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1000),

    supabase
      .from('website_forms')
      .select('id,project_id')
      .in(
        'project_id',
        (
          await supabase
            .from('projects')
            .select('id')
            .eq('email', email)
            .limit(500)
        ).data?.map((project) => project.id) || []
      )
  ]);

  if (projectsResult.error || jobsResult.error) {
    return c.json({
      error: 'Could not load analytics.'
    }, 500);
  }

  const projects = projectsResult.data || [];
  const jobs = jobsResult.data || [];
  const forms = formsResult.data || [];

  let enquiries = 0;

  if (forms.length > 0) {
    const formIds = forms.map((form) => form.id);

    const { count } = await supabase
      .from('form_submissions')
      .select('id', {
        count: 'exact',
        head: true
      })
      .in('form_id', formIds);

    enquiries = count || 0;
  }

  const completedStatuses = new Set([
    'completed',
    'success',
    'preview_ready'
  ]);

  const failedStatuses = new Set([
    'failed',
    'cancelled',
    'error'
  ]);

  const completedBuilds = jobs.filter(
    (job) =>
      completedStatuses.has(
        String(job.status || '').toLowerCase()
      )
  ).length;

  const failedBuilds = jobs.filter(
    (job) =>
      failedStatuses.has(
        String(job.status || '').toLowerCase()
      )
  ).length;

  const finishedBuilds =
    completedBuilds + failedBuilds;

  const successRate =
    finishedBuilds > 0
      ? Math.round(
          (completedBuilds / finishedBuilds) * 100
        )
      : 0;

  const liveWebsites = projects.filter(
    (project) =>
      typeof project.production_url === 'string' &&
      project.production_url.length > 0
  ).length;

  const startToday = new Date();
  startToday.setUTCHours(0, 0, 0, 0);

  const buildsToday = jobs.filter(
    (job) =>
      new Date(job.created_at).getTime() >=
      startToday.getTime()
  ).length;

  const dailyBuilds: Array<{
    date: string;
    label: string;
    count: number;
  }> = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - offset);

    const nextDay = new Date(day);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    dailyBuilds.push({
      date: day.toISOString().slice(0, 10),
      label: day.toLocaleDateString('en', {
        weekday: 'short',
        timeZone: 'UTC'
      }),
      count: jobs.filter((job) => {
        const created = new Date(
          job.created_at
        ).getTime();

        return (
          created >= day.getTime() &&
          created < nextDay.getTime()
        );
      }).length
    });
  }

  const websiteTypes = new Map<string, number>();

  for (const project of projects) {
    const type =
      String(project.website_type || 'Other').trim() ||
      'Other';

    websiteTypes.set(
      type,
      (websiteTypes.get(type) || 0) + 1
    );
  }

  const topWebsiteTypes = [...websiteTypes.entries()]
    .map(([name, count]) => ({
      name,
      count
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return c.json({
    totalWebsites: projects.length,
    liveWebsites,
    draftWebsites: Math.max(
      0,
      projects.length - liveWebsites
    ),
    totalBuilds: jobs.length,
    completedBuilds,
    failedBuilds,
    successRate,
    buildsToday,
    enquiries,
    dailyBuilds,
    topWebsiteTypes,
    recentProjects: projects.slice(0, 5)
  });
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
    return c.html('<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;background:#0b1020;color:white;display:grid;place-items:center;min-height:100vh;text-align:center}div{max-width:420px;padding:30px}h1{color:#79f2c0}</style><div><h1>GitHub connected</h1><p>Return to Nexora.Ai. You can close this page.</p></div>');
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
    return c.html('<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;background:#0b1020;color:white;display:grid;place-items:center;min-height:100vh;text-align:center}div{max-width:420px;padding:30px}h1{color:#79f2c0}</style><div><h1>Vercel connected</h1><p>Return to Nexora.Ai. You can close this page.</p></div>');
  } catch (error) {
    return c.html(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:30px"><h1>Vercel connection failed</h1><p>${escapeHtmlForCallback(error instanceof Error ? error.message : 'Unknown error')}</p></body>`, 400);
  }
});

function escapeHtmlForCallback(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}


app.post('/integrations/:provider/token', async (c) => {
  const provider = c.req.param('provider');

  if (provider !== 'github' && provider !== 'vercel') {
    return c.json({ error: 'Unknown provider.' }, 400);
  }

  const parsed = z.object({
    email: z.string().email(),
    installationId: z.string().uuid(),
    token: z.string().trim().min(10).max(1000)
  }).safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({
      error: `Enter a valid ${provider === 'github' ? 'GitHub' : 'Vercel'} access token.`
    }, 400);
  }

  const access = await requireUser(
    c,
    parsed.data.email,
    parsed.data.installationId
  );

  if (!access) {
    return c.json({
      error: 'Your login session is missing or expired.'
    }, 401);
  }

  if (!access.ok) {
    return c.json({ error: access.error }, access.status);
  }

  const token = parsed.data.token.trim();
  const supabase = requireSupabase(c.env);

  try {
    if (provider === 'github') {
      const profile = await githubRequest(token, '/user');

      await saveConnection(supabase, c.env, {
        email: parsed.data.email,
        provider: 'github',
        accessToken: token,
        externalAccountId: String(profile.id || ''),
        externalAccountName: String(profile.login || 'GitHub user'),
        metadata: {
          avatarUrl: profile.avatar_url || null,
          connectionMethod: 'access_token'
        }
      });

      return c.json({
        connected: true,
        provider: 'github',
        accountName: String(profile.login || 'GitHub user')
      });
    }

    const response = await fetch('https://api.vercel.com/v2/user', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const payload = await response
      .json()
      .catch(() => ({})) as Record<string, unknown>;

    if (!response.ok) {
      const error = payload.error as Record<string, unknown> | undefined;

      throw new Error(
        typeof error?.message === 'string'
          ? `Vercel: ${error.message}`
          : `Vercel rejected this token (${response.status}).`
      );
    }

    const user = (
      payload.user &&
      typeof payload.user === 'object'
        ? payload.user
        : payload
    ) as Record<string, unknown>;

    const accountName = String(
      user.username ||
      user.name ||
      user.email ||
      'Vercel user'
    );

    await saveConnection(supabase, c.env, {
      email: parsed.data.email,
      provider: 'vercel',
      accessToken: token,
      externalAccountId: String(user.id || user.uid || ''),
      externalAccountName: accountName,
      metadata: {
        teamId: null,
        connectionMethod: 'access_token'
      }
    });

    return c.json({
      connected: true,
      provider: 'vercel',
      accountName
    });
  } catch (error) {
    return c.json({
      error:
        error instanceof Error
          ? error.message
          : `Could not connect ${provider}.`
    }, 400);
  }
});

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

  try {
    const accounts = await loadAdminBillingAccounts(supabase);
    return c.json({ accounts });
  } catch (error) {
    return c.json({
      error: error instanceof Error
        ? error.message
        : 'Could not load username accounts.'
    }, 500);
  }
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

    password: strongPasswordSchema
  }).safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({
      error: `Use 3-40 letters, numbers, spaces, dots, dashes or underscores. ${passwordRequirements}`
    }, 400);
  }

  const supabase = requireSupabase(c.env);

  const username = normalizeUsername(parsed.data.username);

  if (!isValidNormalizedUsername(username)) {
    return c.json({ error: 'Enter a valid username.' }, 400);
  }
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
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      max_devices: 2,
      daily_website_limit: 100,
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

app.patch('/admin/accounts/:id/password', async (c) => {
  if (!(await requireAdmin(c))) {
    return c.json({ error: 'Admin access required.' }, 401);
  }

  const parsed = z.object({
    password: strongPasswordSchema
  }).safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({ error: passwordRequirements }, 400);
  }

  const supabase = requireSupabase(c.env);
  const accountId = c.req.param('id');

  const { data: account, error: lookupError } = await supabase
    .from('user_accounts')
    .select('id,username,internal_email')
    .eq('id', accountId)
    .maybeSingle();

  if (lookupError || !account) {
    if (lookupError) {
      logDatabaseError('Admin password reset account lookup failed.', lookupError);
    }
    return c.json({ error: 'User account not found.' }, 404);
  }

  const passwordSalt = bytesToHex(
    crypto.getRandomValues(new Uint8Array(16))
  );
  const passwordIterations = 100000;
  const passwordDigest = await passwordHash(
    parsed.data.password,
    passwordSalt,
    passwordIterations
  );

  const { error: updateError } = await supabase
    .from('user_accounts')
    .update({
      password_salt: passwordSalt,
      password_hash: passwordDigest,
      password_iterations: passwordIterations,
      password_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', account.id);

  if (updateError) {
    logDatabaseError('Admin password reset update failed.', updateError);
    return c.json({ error: 'Could not change the user password.' }, 500);
  }

  const { error: sessionError } = await supabase
    .from('user_sessions')
    .delete()
    .eq('user_id', account.id);

  if (sessionError) {
    logDatabaseError('Admin password reset session revocation failed.', sessionError);
    return c.json({
      error: 'Password changed, but existing sessions could not be revoked. Contact support.'
    }, 500);
  }

  await supabase.from('audit_logs').insert({
    actor_email: adminUsername(c.env),
    action: 'change_username_account_password',
    target_type: 'user_account',
    target_id: account.id,
    metadata: { username: account.username }
  });

  return c.json({ changed: true });
});

app.delete('/admin/accounts/:id', async (c) => {
  if (!(await requireAdmin(c))) {
    return c.json({ error: 'Admin access required.' }, 401);
  }

  const supabase = requireSupabase(c.env);
  const accountId = c.req.param('id');

  const { data: account, error: lookupError } = await supabase
    .from('user_accounts')
    .select('id,username,internal_email')
    .eq('id', accountId)
    .maybeSingle();

  if (lookupError || !account) {
    return c.json({ error: 'User account not found.' }, 404);
  }

  await supabase.from('user_sessions').delete().eq('user_id', account.id);
  await supabase.from('oauth_states').delete().eq('email', account.internal_email);
  await supabase.from('provider_connections').delete().eq('email', account.internal_email);
  await supabase.from('devices').delete().eq('email', account.internal_email);
  await supabase.from('approved_users').delete().eq('email', account.internal_email);

  const { error: deleteError } = await supabase
    .from('user_accounts')
    .delete()
    .eq('id', account.id);

  if (deleteError) {
    return c.json({ error: 'Could not delete the user account.' }, 500);
  }

  await supabase.from('audit_logs').insert({
    actor_email: adminUsername(c.env),
    action: 'delete_username_account',
    target_type: 'user_account',
    target_id: account.id,
    metadata: {
      username: account.username,
      internalEmail: account.internal_email
    }
  });

  return c.json({ deleted: true });
});

app.notFound((c) => c.json({ error: 'Route not found.' }, 404));
app.onError((error, c) => { console.error(error); return c.json({ error: error instanceof Error ? error.message : 'Unexpected server error.' }, 500); });

registerAssistantChatRoutes(app, {
  requireUser,
  requireSupabase
});

registerSubscriptionTokenRoutes(app, {
  requireUser,
  requireAdmin,
  requireSupabase
});
registerCmsRoutes(app, {
  requireUser,
  requireSupabase
});

registerCmsMediaRoutes(app, {
  requireUser,
  requireSupabase
});

export default {
  fetch(
    request: Request,
    env: any,
    executionContext: any
  ) {
    return app.fetch(
      request,
      env,
      executionContext
    );
  },

  async scheduled(
    _controller: any,
    env: any,
    executionContext: any
  ) {
    executionContext.waitUntil(
      processCmsSchedules(
        requireSupabase(env)
      ).then((result) => {
        console.log(
          'CMS schedule processed',
          result
        );
      }).catch((error) => {
        console.error(
          'CMS schedule failed',
          error
        );
      })
    );
  }
};

// NEXORA_SAAS_MOTION_MODE_V1
