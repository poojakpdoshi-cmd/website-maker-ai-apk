import { registerCmsRoutes } from './cms-routes';
import { registerAssistantChatRoutes } from './assistant-chat';
import {
  registerConversationRoutes,
  type ConversationIdentity
} from './conversation-routes';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
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
import { auditGeneratedSecurity } from './security-audit-policy';
import {
  runOptionalThinkMax,
  thinkMaxFlagSchema
} from './thinkmax';
import {
  NexoraTokenError,
  finalizeNexoraTokens,
  getNexoraOperationCost,
  loadAdminBillingAccounts,
  refundNexoraTokens,
  registerSubscriptionTokenRoutes,
  reserveNexoraTokens
} from './subscription-tokens';
import { registerPreferenceRoutes } from './preferences-routes';
import { registerLiveSiteReadRoutes } from './live-sites-routes';
import {
  backendPlanHash,
  buildBackendProvisioningPlan,
  isolateBackendProvisioningPlan,
  type BackendProvisioningPlan
} from './backend-planning';
import {
  firebaseProviderOperations,
  listFirebaseProjects,
  provisionFirebaseBackend
} from './firebase-provider';
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
  ARCEE_API_KEY?: string;
  ARCEE_QA_MODEL?: string;
  QA_PROVIDER?: string;
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
  FIREBASE_CLIENT_ID?: string;
  FIREBASE_CLIENT_SECRET?: string;
  FIREBASE_REDIRECT_URI?: string;
  OAUTH_ALLOWED_ORIGINS?: string;
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
app.use('*', secureHeaders());
app.use('*', cors({
  origin: (origin, c) => {
    if (!origin) return '';
    const allowed = new Set([
      'http://localhost',
      'https://localhost',
      'capacitor://localhost',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      ...(c.env.OAUTH_ALLOWED_ORIGINS || '')
        .split(',')
        .map((value: string) => value.trim().replace(/\/$/, ''))
        .filter((value: string) =>
          /^https:\/\/[^/]+$/i.test(value) ||
          /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(value)
        )
    ]);
    return allowed.has(origin.replace(/\/$/, '')) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Id']
}));

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

  const { data: user, error: userError } = await supabase.from('approved_users').select('email,status,expires_at,max_devices').eq('email', email).maybeSingle();
  if (userError) return { ok: false, status: 503, error: 'Could not check account access.' };
  if (!user || user.status !== 'active') return { ok: false, status: 403, error: 'This email has not been approved by the admin.' };

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

async function conversationIdentity(
  c: Context<{ Bindings: Bindings }>
): Promise<ConversationIdentity | null> {
  const session = await usernameSessionIdentity(
    c.env,
    c.req.header('Authorization')
  );
  if (session) {
    return {
      accountId: session.userId,
      email: session.internalEmail,
      username: session.username
    };
  }

  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return null;
  const supabase = getSupabase(c.env);
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('user_accounts')
    .select('id,username,internal_email')
    .eq('internal_email', email)
    .eq('status', 'active')
    .maybeSingle();
  if (error || !data) return null;
  return {
    accountId: String(data.id),
    email: String(data.internal_email).toLowerCase(),
    username: String(data.username)
  };
}

async function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`External provider request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function safeProjectName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'website';
}

type OauthProvider = 'github' | 'vercel' | 'firebase';

async function createOauthState(
  supabase: SupabaseClient,
  email: string,
  provider: OauthProvider,
  metadata: Record<string, unknown> = {}
): Promise<string> {
  const state = crypto.randomUUID();
  const { error } = await supabase.from('oauth_states').insert({
    state,
    email,
    provider,
    metadata,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  });
  if (error) throw new Error('Could not start account connection.');
  return state;
}

async function consumeOauthState(supabase: SupabaseClient, state: string, provider: OauthProvider) {
  const { data, error } = await supabase.from('oauth_states').select('state,email,provider,expires_at,metadata').eq('state', state).eq('provider', provider).maybeSingle();
  if (error || !data) throw new Error('Connection request is invalid or expired.');
  await supabase.from('oauth_states').delete().eq('state', state);
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Error('Connection request has expired.');
  return data as {
    email: string;
    metadata?: Record<string, unknown>;
  };
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

async function saveFirebaseConnection(
  supabase: SupabaseClient,
  env: Bindings,
  input: {
    email: string;
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    accountId?: string;
    accountName?: string;
    scopes: string[];
  }
): Promise<void> {
  const expiresAt = new Date(
    Date.now() + Math.max(60, Number(input.expiresIn || 3600)) * 1000
  ).toISOString();
  const { data: connection, error } = await supabase
    .from('backend_connections')
    .upsert({
      owner_email: input.email.toLowerCase(),
      provider: 'firebase',
      status: 'connected',
      external_account_id: input.accountId || null,
      external_account_name: input.accountName || null,
      granted_scopes: input.scopes,
      token_expires_at: expiresAt,
      metadata: {},
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'owner_email,provider' })
    .select('id')
    .single();
  if (error || !connection) {
    throw new Error('Could not save the Firebase connection.');
  }
  const existing = await supabase
    .from('encrypted_provider_credentials')
    .select('encrypted_refresh_token')
    .eq('connection_id', connection.id)
    .maybeSingle();
  const encryptedRefreshToken = input.refreshToken
    ? await encryptSecret(env, input.refreshToken)
    : existing.data?.encrypted_refresh_token || null;
  const { error: credentialError } = await supabase
    .from('encrypted_provider_credentials')
    .upsert({
      connection_id: connection.id,
      encrypted_access_token: await encryptSecret(env, input.accessToken),
      encrypted_refresh_token: encryptedRefreshToken,
      encryption_version: 1,
      updated_at: new Date().toISOString()
    }, { onConflict: 'connection_id' });
  if (credentialError) {
    throw new Error('Could not securely save Firebase credentials.');
  }
}

async function firebaseAccessToken(
  supabase: SupabaseClient,
  env: Bindings,
  email: string
): Promise<string> {
  const { data: connection, error } = await supabase
    .from('backend_connections')
    .select('id,status,token_expires_at')
    .eq('owner_email', email.toLowerCase())
    .eq('provider', 'firebase')
    .maybeSingle();
  if (error || !connection || connection.status !== 'connected') {
    throw new Error('Connect Firebase before continuing.');
  }
  const { data: credentials, error: credentialError } = await supabase
    .from('encrypted_provider_credentials')
    .select('encrypted_access_token,encrypted_refresh_token')
    .eq('connection_id', connection.id)
    .maybeSingle();
  if (credentialError || !credentials?.encrypted_access_token) {
    throw new Error('Stored Firebase credentials are unavailable.');
  }
  if (
    connection.token_expires_at &&
    new Date(connection.token_expires_at).getTime() > Date.now() + 60000
  ) {
    return decryptSecret(env, credentials.encrypted_access_token);
  }
  if (
    !credentials.encrypted_refresh_token ||
    !env.FIREBASE_CLIENT_ID ||
    !env.FIREBASE_CLIENT_SECRET
  ) {
    throw new Error('Reconnect Firebase because the OAuth session expired.');
  }
  const refreshToken = await decryptSecret(
    env,
    credentials.encrypted_refresh_token
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.FIREBASE_CLIENT_ID,
        client_secret: env.FIREBASE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    const data = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || !data.access_token) {
      await supabase.from('backend_connections').update({
        status: 'expired',
        updated_at: new Date().toISOString()
      }).eq('id', connection.id);
      throw new Error('Reconnect Firebase because Google rejected the saved OAuth session.');
    }
    const accessToken = String(data.access_token);
    await supabase.from('encrypted_provider_credentials').update({
      encrypted_access_token: await encryptSecret(env, accessToken),
      updated_at: new Date().toISOString()
    }).eq('connection_id', connection.id);
    await supabase.from('backend_connections').update({
      token_expires_at: new Date(
        Date.now() + Number(data.expires_in || 3600) * 1000
      ).toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', connection.id);
    return accessToken;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Firebase token refresh timed out after 30000ms.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function githubRequest(token: string, path: string, init: RequestInit = {}) {
  const response = await boundedFetch(`https://api.github.com${path}`, {
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

async function deployToVercel(
  connection: Awaited<ReturnType<typeof getConnection>>,
  name: string,
  files: GeneratedProjectFile[],
  existingProject?: string | null,
  environment: Record<string, string> = {}
) {
  const teamId = typeof connection.metadata?.teamId === 'string' ? connection.metadata.teamId : '';
  const query = new URLSearchParams({ forceNew: '1', skipAutoDetectionConfirmation: '1' });
  if (teamId) query.set('teamId', teamId);
  const body: Record<string, unknown> = {
    name: safeProjectName(name),
    files: files.map((file) => ({ file: file.path, data: utf8ToBase64(file.content), encoding: 'base64' })),
    target: 'production',
    env: environment,
    build: { env: environment },
    projectSettings: {
      framework: 'vite',
      installCommand: 'npm install',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
      skipGitConnectDuringLink: true
    }
  };
  if (existingProject) body.project = existingProject;
  const response = await boundedFetch(`https://api.vercel.com/v13/deployments?${query.toString()}`, {
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

function safeBackendEnvironment(
  value: unknown
): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const allowed = new Set([
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_DATABASE_ID',
    'VITE_FIREBASE_NAMESPACE',
    'VITE_NEXORA_BACKEND_URL',
    'VITE_NEXORA_BACKEND_KEY'
  ]);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) =>
        allowed.has(key) &&
        typeof item === 'string' &&
        item.length > 0 &&
        item.length <= 500
      ) as Array<[string, string]>
  );
}

function managedDataStoreSource(): string {
  return `const apiBase = String(import.meta.env.VITE_NEXORA_BACKEND_URL || '').replace(/\\/$/, '');
const publicKey = String(import.meta.env.VITE_NEXORA_BACKEND_KEY || '');

async function request(collection, path = '', init = {}) {
  if (!apiBase || !publicKey) throw new Error('Nexora managed backend is not configured.');
  const response = await fetch(
    apiBase + '/public/backends/' + encodeURIComponent(publicKey) + '/' +
      encodeURIComponent(collection) + path,
    {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) }
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Managed backend request failed.');
  return data;
}

export async function listRecords(collection) {
  return (await request(collection)).records || [];
}
export async function createRecord(collection, value) {
  return (await request(collection, '', { method: 'POST', body: JSON.stringify(value) })).record;
}
export async function updateRecord(collection, id, value) {
  return (await request(collection, '/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: JSON.stringify(value)
  })).record;
}
export async function deleteRecord(collection, id) {
  await request(collection, '/' + encodeURIComponent(id), { method: 'DELETE' });
}
export function subscribeRecords(collection, onValue, onError) {
  let active = true;
  const refresh = async () => {
    try { if (active) onValue(await listRecords(collection)); }
    catch (error) { if (active && onError) onError(error); }
  };
  void refresh();
  const timer = window.setInterval(refresh, 15000);
  return () => { active = false; window.clearInterval(timer); };
}
`;
}

function injectManagedDataStore(
  files: GeneratedProjectFile[]
): GeneratedProjectFile[] {
  const replacement = managedDataStoreSource();
  let replaced = false;
  const next = files.map((file) => {
    if (file.path !== 'src/services/dataStore.js') return file;
    replaced = true;
    return { ...file, content: replacement };
  });
  if (!replaced) {
    next.push({
      path: 'src/services/dataStore.js',
      content: replacement
    });
  }
  return next;
}

async function deleteVercelDeployment(
  connection: Awaited<ReturnType<typeof getConnection>>,
  deploymentId: string
): Promise<void> {
  const teamId = typeof connection.metadata?.teamId === 'string'
    ? connection.metadata.teamId
    : '';
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}${query}`,
      {
        method: 'DELETE',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${connection.accessToken}` }
      }
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Vercel could not remove the deployment (HTTP ${response.status}).`);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Vercel deployment deletion timed out after 30000ms.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  let remaining = 90000;
  const compact: Array<{
    path: string;
    content: string;
  }> = [];

  for (const file of files) {
    if (remaining <= 0) break;

    const content = file.content.slice(
      0,
      Math.min(remaining, 24000)
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

class GenerationCancelledError extends Error {
  constructor() {
    super('Generation was cancelled by the user.');
    this.name = 'GenerationCancelledError';
  }
}

async function assertGenerationActive(
  supabase: SupabaseClient,
  jobId: string,
  email: string
): Promise<void> {
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('status,cancel_requested_at')
    .eq('id', jobId)
    .eq('email', email)
    .maybeSingle();
  if (error || !data) {
    throw new Error('Generation job state could not be verified.');
  }
  if (
    data.cancel_requested_at ||
    ['cancelled', 'canceled'].includes(String(data.status).toLowerCase())
  ) {
    throw new GenerationCancelledError();
  }
}

function retryableGenerationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /timed out|timeout|network|provider|rate limit|temporar|stopped responding|unavailable|empty response|could not reach/i.test(
    message
  );
}

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

export const GENERATION_STALE_AFTER_MS = 12 * 60 * 1000;

export function generationJobIsStale(
  status: string,
  updatedAt: string,
  now = Date.now()
): boolean {
  const updated = new Date(updatedAt).getTime();
  return ['queued', 'running'].includes(status.toLowerCase()) &&
    Number.isFinite(updated) &&
    now - updated >= GENERATION_STALE_AFTER_MS;
}

async function failStaleGenerationJobs(
  supabase: SupabaseClient
): Promise<number> {
  const cutoff = new Date(
    Date.now() - GENERATION_STALE_AFTER_MS
  ).toISOString();
  const { data: jobs, error } = await supabase
    .from('generation_jobs')
    .select('id,email,status,current_step,token_reservation_id')
    .in('status', ['queued', 'running'])
    .lt('updated_at', cutoff)
    .limit(100);
  if (error) throw new Error('Could not sweep stale generation jobs.');
  let failed = 0;
  for (const job of jobs || []) {
    const failure = `Generation stopped responding during ${job.current_step || job.status}. The job was closed automatically and can be retried safely.`;
    const now = new Date().toISOString();
    const { data: updated } = await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        current_step: 'failed',
        current_agent: null,
        progress: 100,
        error_message: failure,
        failed_stage: job.current_step || job.status,
        retryable: true,
        completed_at: now,
        updated_at: now
      })
      .eq('id', job.id)
      .in('status', ['queued', 'running'])
      .select('id')
      .maybeSingle();
    if (!updated) continue;
    await refundNexoraTokens(
      supabase,
      typeof job.token_reservation_id === 'string'
        ? job.token_reservation_id
        : null,
      failure
    );
    await supabase.from('generation_job_events').insert({
      job_id: job.id,
      email: job.email,
      event_type: 'watchdog_failed',
      agent_name: 'Generation Watchdog',
      status: 'failed',
      title: 'Unresponsive generation closed',
      detail: failure,
      progress: 100,
      metadata: {
        failedStage: job.current_step || job.status,
        retryable: true,
        tokensRefunded: true
      },
      created_at: now
    });
    failed += 1;
  }
  return failed;
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
    websitePalette: z.object({
      id: z.string().max(40),
      label: z.string().max(60),
      primary: z.string().regex(/^#[0-9a-f]{6}$/i),
      secondary: z.string().regex(/^#[0-9a-f]{6}$/i),
      background: z.string().regex(/^#[0-9a-f]{6}$/i),
      text: z.string().regex(/^#[0-9a-f]{6}$/i)
    }).optional(),
    thinkMax: thinkMaxFlagSchema
  }).safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({ error: 'A valid website request is required.' }, 400);
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
      workflow_mode: parsed.data.thinkMax === true
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
      'id,project_id,status,current_step,current_agent,progress,workflow_mode,agent_states,error_message,failed_stage,retryable,attempt_count,cancel_requested_at,created_at,started_at,updated_at,completed_at,duration_ms,token_reservation_id'
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
        failed_stage: job.current_step || normalizedStatus,
        retryable: true,
        completed_at: completedAt,
        updated_at: completedAt
      })
      .eq('id', job.id)
      .eq('email', email)
      .in('status', ['queued', 'running'])
      .select(
         'id,project_id,status,current_step,current_agent,progress,workflow_mode,agent_states,error_message,failed_stage,retryable,attempt_count,cancel_requested_at,created_at,started_at,updated_at,completed_at,duration_ms,token_reservation_id'
      )
      .maybeSingle();

    if (failedJob) {
      await refundNexoraTokens(
        supabase,
        typeof job.token_reservation_id === 'string'
          ? job.token_reservation_id
          : null,
        failure
      );
      Object.assign(job, failedJob);
    }
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

app.post('/generation-jobs/:id/cancel', async (c) => {
  const email = await identityEmail(
    c.env,
    c.req.header('Authorization')
  );
  if (!email) {
    return c.json({ error: 'Your login session is missing or expired.' }, 401);
  }
  const access = await checkAccess(c.env, email);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const supabase = requireSupabase(c.env);
  const { data: job, error } = await supabase
    .from('generation_jobs')
    .select('id,status,progress,token_reservation_id')
    .eq('id', c.req.param('id'))
    .eq('email', email)
    .maybeSingle();
  if (error || !job) return c.json({ error: 'Generation job not found.' }, 404);
  const status = String(job.status).toLowerCase();
  if (['completed', 'failed', 'cancelled', 'canceled'].includes(status)) {
    return c.json({ error: `A ${status} job cannot be cancelled.` }, 409);
  }

  const now = new Date().toISOString();
  if (status === 'queued') {
    await refundNexoraTokens(
      supabase,
      typeof job.token_reservation_id === 'string'
        ? job.token_reservation_id
        : null,
      'Generation cancelled before execution.'
    );
    await recordGenerationEvent(supabase, {
      jobId: job.id,
      email,
      eventType: 'cancelled',
      agentName: 'Orchestrator',
      title: 'Generation cancelled',
      detail: 'The queued generation was cancelled before execution.',
      progress: 100,
      jobStatus: 'cancelled'
    });
    await supabase.from('generation_jobs').update({
      cancel_requested_at: now,
      cancelled_at: now,
      completed_at: now,
      current_step: 'cancelled',
      error_message: 'Generation was cancelled by the user.',
      retryable: true
    }).eq('id', job.id).eq('email', email);
  } else {
    await supabase.from('generation_jobs').update({
      cancel_requested_at: now,
      current_step: 'cancellation_requested'
    }).eq('id', job.id).eq('email', email);
    await recordGenerationEvent(supabase, {
      jobId: job.id,
      email,
      eventType: 'cancellation_requested',
      agentName: 'Orchestrator',
      title: 'Cancellation requested',
      detail: 'The active remote stage will stop at its bounded timeout or next safe checkpoint.',
      progress: Number(job.progress || 0),
      jobStatus: 'running'
    });
  }
  return c.json({
    jobId: job.id,
    status: status === 'queued' ? 'cancelled' : 'cancellation_requested'
  });
});

app.post('/generation-jobs/:id/retry', async (c) => {
  const email = await identityEmail(
    c.env,
    c.req.header('Authorization')
  );
  if (!email) {
    return c.json({ error: 'Your login session is missing or expired.' }, 401);
  }
  const access = await checkAccess(c.env, email);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const supabase = requireSupabase(c.env);
  const { data: job, error } = await supabase
    .from('generation_jobs')
    .select('id,status,failed_stage,retryable,attempt_count')
    .eq('id', c.req.param('id'))
    .eq('email', email)
    .maybeSingle();
  if (error || !job) return c.json({ error: 'Generation job not found.' }, 404);
  if (String(job.status).toLowerCase() !== 'failed' || job.retryable !== true) {
    return c.json({
      error: 'Only a safely retryable failed stage can be retried.'
    }, 409);
  }

  const resumeFromStage = String(job.failed_stage || 'planning');
  const { data: queued, error: queueError } = await supabase
    .from('generation_jobs')
    .update({
      status: 'queued',
      current_step: 'retry_queued',
      current_agent: 'Orchestrator',
      progress: 2,
      attempt_count: Number(job.attempt_count || 0) + 1,
      resume_from_stage: resumeFromStage,
      retryable: false,
      error_message: null,
      failed_stage: null,
      cancel_requested_at: null,
      cancelled_at: null,
      completed_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', job.id)
    .eq('email', email)
    .eq('status', 'failed')
    .select('id')
    .maybeSingle();
  if (queueError || !queued) {
    return c.json({ error: 'Could not queue the failed stage retry.' }, 409);
  }

  await recordGenerationEvent(supabase, {
    jobId: job.id,
    email,
    eventType: 'retry_queued',
    agentName: 'Orchestrator',
    title: 'Failed stage queued for retry',
    detail: `Retrying safely from ${resumeFromStage} without another token charge.`,
    progress: 2,
    jobStatus: 'queued',
    metadata: {
      resumeFromStage,
      attempt: Number(job.attempt_count || 0) + 1,
      additionalCharge: false
    }
  });
  return c.json({
    jobId: job.id,
    status: 'queued',
    progress: 2,
    resumeFromStage,
    additionalCharge: false
  }, 202);
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
    websitePalette: z.object({
      id: z.string().max(40),
      label: z.string().max(60),
      primary: z.string().regex(/^#[0-9a-f]{6}$/i),
      secondary: z.string().regex(/^#[0-9a-f]{6}$/i),
      background: z.string().regex(/^#[0-9a-f]{6}$/i),
      text: z.string().regex(/^#[0-9a-f]{6}$/i)
    }).optional(),
    thinkMax: thinkMaxFlagSchema
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Email, device identifier and a detailed website prompt are required.' }, 400);
  const email = parsed.data.email.toLowerCase();
  const access = await requireUser(c, email, parsed.data.installationId);
  if (!access) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const supabase = requireSupabase(c.env);
  const projectId = crypto.randomUUID();
  const jobId = parsed.data.jobId || crypto.randomUUID();
  let retryWithoutCharge = false;

  if (parsed.data.jobId) {
    const { data: existingJob, error: existingJobError } =
      await supabase
        .from('generation_jobs')
        .select('id,attempt_count')
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
    retryWithoutCharge = Number(existingJob.attempt_count || 0) > 0;

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
        workflow_mode: parsed.data.thinkMax === true
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
        : 0);

    if (!retryWithoutCharge) {
      const reservation = await reserveNexoraTokens(
        supabase,
        email,
        generationCost,
        'website_generation',
        jobId,
        parsed.data.image
          ? 'Website generation with image analysis'
          : 'Complete website generation'
      );

      generationReservationId = reservation.reservationId;
      await supabase.from('generation_jobs').update({
        token_reservation_id: generationReservationId,
        generation_cost: generationCost
      }).eq('id', jobId).eq('email', email);
    } else {
      await recordGenerationEvent(supabase, {
        jobId,
        email,
        eventType: 'retry_charge_reused',
        agentName: 'Billing',
        title: 'Retry is not charged again',
        detail: 'The failed internal stage retry uses the original generation entitlement.',
        progress: 6,
        jobStatus: 'running',
        metadata: { additionalCharge: false }
      });
    }
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

    const paletteInstruction = parsed.data.websitePalette
      ? `\n\nBinding website palette (${parsed.data.websitePalette.label}): primary ${parsed.data.websitePalette.primary}, secondary ${parsed.data.websitePalette.secondary}, background ${parsed.data.websitePalette.background}, text ${parsed.data.websitePalette.text}. Apply this to the generated website only.`
      : '';
    const planResult = await buildWebsitePlan((
      parsed.data.prompt +
      paletteInstruction +
      '\n\n' +
      buildFullStackInstruction(parsed.data.prompt)
    ), {
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
      eventType: planResult.fallbackUsed
        ? 'planner_fallback_used'
        : 'planner_remote_completed',
      agentName: planResult.fallbackUsed
        ? 'Structured Local Planner'
        : 'Remote Planner',
      title: planResult.fallbackUsed
        ? 'Structured local plan completed'
        : 'Remote planner completed',
      detail: planResult.fallbackReason ||
        'The configured planner produced the binding application specification.',
      progress: 28,
      jobStatus: 'running',
      metadata: {
        fallbackUsed: planResult.fallbackUsed,
        projectKind: planResult.plan.appSpec.projectKind,
        screenCount: planResult.plan.appSpec.screens.length,
        entityCount: planResult.plan.appSpec.entities.length,
        calculationCount: planResult.plan.appSpec.calculations.length
      }
    });
    await supabase.from('generation_jobs').update({
      output_plan: planResult.plan
    }).eq('id', jobId).eq('email', email);
    await assertGenerationActive(supabase, jobId, email);

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
    await supabase.from('generation_jobs').update({
      output_plan: generationPlan
    }).eq('id', jobId).eq('email', email);
    await assertGenerationActive(supabase, jobId, email);

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
          eventType: 'coder_failed',
          agentName: 'Structured Application Builder',
          title: 'Remote coder failed; structured builder retained',
          detail:
            coderError instanceof Error
              ? coderError.message
              : 'Remote coder was unavailable.',
          progress: 45,
          jobStatus: 'running'
        });
      }
    }
    await assertGenerationActive(supabase, jobId, email);

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

        const replacementPaths = new Set(
          codingPatch.files.map((file) => file.path)
        );
        if (
          !replacementPaths.has('src/App.jsx') ||
          !replacementPaths.has('src/styles.css')
        ) {
          throw new Error(
            'Coder output was rejected because complete replacement src/App.jsx and src/styles.css files were not returned.'
          );
        }

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
            `${codingPatch.files.length} complete generated file(s) were accepted.`,
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
    await assertGenerationActive(supabase, jobId, email);

    const deterministicValidation =
      validateGeneratedProject(
        generated.files,
        parsed.data.prompt,
        generationPlan.appSpec
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
            appSpec: generationPlan.appSpec,
            codingBrief,
            files: compactProjectFiles(generated.files)
          })
        );

        const review = parseCouncilReview(
          reviewerOutput
        );
        await assertGenerationActive(supabase, jobId, email);

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
                appSpec: generationPlan.appSpec,
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
          await assertGenerationActive(supabase, jobId, email);

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
        parsed.data.prompt,
        generationPlan.appSpec
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
                appSpec: generationPlan.appSpec,
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
            progress: 95,
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
    await assertGenerationActive(supabase, jobId, email);

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
    const { data: failedState } = await supabase
      .from('generation_jobs')
      .select('current_step')
      .eq('id', jobId)
      .eq('email', email)
      .maybeSingle();
    const failedStage = String(failedState?.current_step || 'generation');

    await refundNexoraTokens(
      supabase,
      generationReservationId,
      failureMessage
    );

    if (error instanceof GenerationCancelledError) {
      const cancelledAt = new Date().toISOString();
      await recordGenerationEvent(supabase, {
        jobId,
        email,
        eventType: 'cancelled',
        agentName: 'Orchestrator',
        title: 'Generation cancelled',
        detail: failureMessage,
        progress: 100,
        jobStatus: 'cancelled',
        metadata: { cancelledDuring: failedStage }
      });
      await supabase.from('generation_jobs').update({
        status: 'cancelled',
        current_step: 'cancelled',
        current_agent: null,
        progress: 100,
        error_message: failureMessage,
        failed_stage: failedStage,
        retryable: true,
        cancelled_at: cancelledAt,
        completed_at: cancelledAt
      }).eq('id', jobId).eq('email', email);
      return c.json({
        error: failureMessage,
        code: 'generation_cancelled',
        retryable: true
      }, 409);
    }

    const retryable = retryableGenerationFailure(error);

    await recordGenerationEvent(supabase, {
      jobId,
      email,
      eventType: 'failed',
      agentName: 'Nexora.Ai Council',
      title: 'Generation failed',
      detail: failureMessage,
      progress: 100,
      jobStatus: 'failed',
      metadata: {
        failedStage,
        retryable
      }
    });

    await supabase.from('generation_jobs').update({
      status: 'failed',
      current_step: 'failed',
      current_agent: null,
      error_message: failureMessage,
      failed_stage: failedStage,
      retryable,
      completed_at: new Date().toISOString()
    }).eq('id', jobId);
    return c.json({
      error: failureMessage,
      failedStage,
      retryable
    }, retryable ? 503 : 422);
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
    const versionNumber = Number(latest.version_number) + 1;
    const { error } = await supabase.from('project_versions').insert({
      full_stack_report: createFullStackReport(
        parsed.data.instruction,
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
    .select('id,name,website_type,status,framework,github_repository,production_url,deployment_state,created_at,updated_at')
    .eq('email', parsed.data.email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Project list query failed:', error.message);
    return c.json({ error: 'Could not load projects.' }, 500);
  }

  return c.json({ projects: data || [] });
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
  const { data: version } = await supabase.from('project_versions').select('version_number,plan,preview_html,created_at,full_stack_report').eq('project_id', project.id).order('version_number', { ascending: false }).limit(1).maybeSingle();
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
  const appSpec = (project.plan as WebsitePlan | null)?.appSpec;
  const { data: backendConfig } = await supabase
    .from('website_backend_configs')
    .select('id,mode,status,safe_public_config,verified_at')
    .eq('project_id', projectId)
    .eq('owner_email', parsed.data.email.toLowerCase())
    .maybeSingle();
  if (!backendConfig) {
    return c.json({
      error: 'Complete the Backend & Database step before publishing.',
      code: 'backend_setup_required'
    }, 409);
  }
  if (
    appSpec?.backend.required &&
    (
      backendConfig.mode === 'none' ||
      backendConfig.status !== 'verified' ||
      !backendConfig.verified_at
    )
  ) {
    return c.json({
      error: 'Publish remains disabled until the required backend passes a real read/write verification.',
      code: 'backend_verification_required'
    }, 409);
  }

  let publishReservationId: string | null = null;
  let siteId: string | null = null;

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
      return c.json(
        {
          error:
            'Security audit blocked publishing.',
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

    const cmsFiles = cmsSettings?.public_slug
      ? injectCmsRuntime(
          files,
          new URL(c.req.url).origin,
          cmsSettings.public_slug
        )
      : files;
    const deployFiles = backendConfig.mode === 'nexora_managed'
      ? injectManagedDataStore(cmsFiles)
      : cmsFiles;
    const repository = await pushToGitHub(github.accessToken, github.external_account_name, project.name, deployFiles);
    const deployment = await deployToVercel(
      vercel,
      `${projectSlug(project.plan as WebsitePlan)}-${projectId.slice(0, 6)}`,
      deployFiles,
      project.vercel_project_id,
      safeBackendEnvironment(backendConfig.safe_public_config)
    );
    const isReady = deployment.readyState === 'READY';
    const now = new Date().toISOString();
    await supabase.from('projects').update({
      status: isReady ? 'deployed' : 'deploying',
      github_repository: repository.url,
      vercel_project_id: deployment.projectId,
      vercel_deployment_id: deployment.deploymentId,
      production_url: isReady ? deployment.deploymentUrl : null,
      deployment_state: deployment.readyState
    }).eq('id', projectId);
    const { data: site, error: siteError } = await supabase
      .from('published_sites')
      .upsert({
        owner_email: parsed.data.email.toLowerCase(),
        project_id: projectId,
        name: project.name,
        status: isReady ? 'live' : 'deploying',
        hosting_provider: 'vercel',
        live_url: isReady ? deployment.deploymentUrl : null,
        github_repository: repository.url,
        published_at: isReady ? now : null,
        last_deployment_at: now,
        updated_at: now
      }, { onConflict: 'owner_email,project_id' })
      .select('id')
      .single();
    if (siteError || !site) {
      throw new Error('Deployment started but the live website record could not be saved.');
    }
    siteId = String(site.id);
    const { data: deploymentRecord, error: deploymentRecordError } = await supabase
      .from('site_deployments')
      .insert({
        site_id: siteId,
        owner_email: parsed.data.email.toLowerCase(),
        project_id: projectId,
        provider: 'vercel',
        provider_project_id: deployment.projectId,
        provider_deployment_id: deployment.deploymentId,
        status: isReady ? 'ready' : 'building',
        live_url: deployment.deploymentUrl,
        started_at: now,
        ready_at: isReady ? now : null,
        completed_at: isReady ? now : null
      })
      .select('id')
      .single();
    if (deploymentRecordError || !deploymentRecord) {
      throw new Error('Deployment started but its event record could not be saved.');
    }
    await supabase.from('deployment_events').insert({
      deployment_id: deploymentRecord.id,
      site_id: siteId,
      owner_email: parsed.data.email.toLowerCase(),
      event_type: isReady ? 'provider_ready' : 'provider_building',
      status: isReady ? 'ready' : 'building',
      message: isReady
        ? 'Vercel confirmed the production deployment is ready.'
        : `Vercel accepted the deployment with state ${deployment.readyState}.`,
      metadata: {
        providerDeploymentId: deployment.deploymentId
      }
    });
    if (isReady && deployment.deploymentUrl) {
      const hostname = new URL(deployment.deploymentUrl).hostname;
      await supabase.from('website_forms').update({ allowed_domain: hostname }).eq('project_id', projectId);
    }
    await finalizeNexoraTokens(supabase, publishReservationId);
    return c.json({
      projectId,
      siteId,
      githubRepository: repository.url,
      productionUrl: isReady ? deployment.deploymentUrl : null,
      providerUrl: deployment.deploymentUrl,
      deploymentId: deployment.deploymentId,
      state: deployment.readyState,
      live: isReady
    });
  } catch (error) {
    await refundNexoraTokens(
      supabase,
      publishReservationId,
      error instanceof Error ? error.message : 'Publishing failed'
    );
    await supabase.from('projects').update({ status: 'publish_failed', deployment_state: 'ERROR' }).eq('id', projectId);
    if (siteId) {
      await supabase.from('published_sites').update({
        status: 'failed',
        updated_at: new Date().toISOString()
      }).eq('id', siteId).eq('owner_email', parsed.data.email.toLowerCase());
    }
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
  const response = await boundedFetch(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(project.vercel_deployment_id)}${query}`,
    { headers: { Authorization: `Bearer ${vercel.accessToken}` } }
  );
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return c.json({ error: 'Could not read deployment status.' }, 502);
  const state = String(data.readyState || data.status || project.deployment_state || 'UNKNOWN');
  const providerUrl = data.url
    ? `https://${String(data.url).replace(/^https?:\/\//, '')}`
    : project.production_url;
  const productionUrl = state === 'READY' ? providerUrl : null;
  await supabase.from('projects').update({
    deployment_state: state,
    status: state === 'READY' ? 'deployed' : state === 'ERROR' ? 'publish_failed' : 'deploying',
    production_url: productionUrl
  }).eq('id', project.id);
  const { data: site } = await supabase
    .from('published_sites')
    .select('id,status')
    .eq('project_id', project.id)
    .eq('owner_email', parsed.data.email.toLowerCase())
    .maybeSingle();
  const { data: deploymentRecord } = await supabase
    .from('site_deployments')
    .select('id,status')
    .eq('provider_deployment_id', project.vercel_deployment_id)
    .eq('owner_email', parsed.data.email.toLowerCase())
    .maybeSingle();
  if (site) {
    const siteStatus = state === 'READY'
      ? 'live'
      : state === 'ERROR'
        ? 'failed'
        : 'deploying';
    await supabase.from('published_sites').update({
      status: siteStatus,
      live_url: productionUrl,
      published_at: state === 'READY' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq('id', site.id).eq('owner_email', parsed.data.email.toLowerCase());
    if (deploymentRecord) {
      const deploymentStatus = state === 'READY'
        ? 'ready'
        : state === 'ERROR'
          ? 'failed'
          : 'building';
      if (deploymentRecord.status !== deploymentStatus) {
        await supabase.from('site_deployments').update({
          status: deploymentStatus,
          live_url: providerUrl,
          error_message: typeof data.errorMessage === 'string'
            ? data.errorMessage
            : null,
          ready_at: state === 'READY' ? new Date().toISOString() : null,
          completed_at: ['READY', 'ERROR'].includes(state)
            ? new Date().toISOString()
            : null
        }).eq('id', deploymentRecord.id).eq('owner_email', parsed.data.email.toLowerCase());
        await supabase.from('deployment_events').insert({
          deployment_id: deploymentRecord.id,
          site_id: site.id,
          owner_email: parsed.data.email.toLowerCase(),
          event_type: `provider_${state.toLowerCase()}`,
          status: deploymentStatus,
          message: state === 'READY'
            ? 'Hosting provider confirmed the website is live.'
            : state === 'ERROR'
              ? String(data.errorMessage || 'Hosting provider reported a deployment failure.')
              : `Hosting provider state changed to ${state}.`,
          metadata: {}
        });
      }
    }
  }
  return c.json({
    state,
    productionUrl,
    live: state === 'READY',
    inspectorUrl: data.inspectorUrl || null,
    errorMessage: data.errorMessage || null
  });
});

app.post('/live-sites/:id/unpublish', async (c) => {
  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  const supabase = requireSupabase(c.env);
  const { data: site } = await supabase
    .from('published_sites')
    .select('id,project_id,status')
    .eq('id', c.req.param('id'))
    .eq('owner_email', email)
    .maybeSingle();
  if (!site) return c.json({ error: 'Live website not found.' }, 404);
  if (site.status === 'unpublished') {
    return c.json({ siteId: site.id, status: 'unpublished' });
  }
  const { data: deployment } = await supabase
    .from('site_deployments')
    .select('id,provider,provider_deployment_id,status')
    .eq('site_id', site.id)
    .eq('owner_email', email)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (deployment?.provider === 'vercel' && deployment.provider_deployment_id) {
    const connection = await getConnection(supabase, c.env, email, 'vercel');
    await deleteVercelDeployment(
      connection,
      String(deployment.provider_deployment_id)
    );
  }
  const now = new Date().toISOString();
  if (deployment) {
    await supabase.from('site_deployments').update({
      status: 'cancelled',
      completed_at: now
    }).eq('id', deployment.id).eq('owner_email', email);
    await supabase.from('deployment_events').insert({
      deployment_id: deployment.id,
      site_id: site.id,
      owner_email: email,
      event_type: 'unpublished',
      status: 'cancelled',
      message: 'The authenticated owner unpublished this deployment.',
      metadata: {}
    });
  }
  await supabase.from('published_sites').update({
    status: 'unpublished',
    live_url: null,
    updated_at: now
  }).eq('id', site.id).eq('owner_email', email);
  await supabase.from('projects').update({
    status: 'preview_ready',
    production_url: null,
    deployment_state: 'CANCELLED'
  }).eq('id', site.project_id).eq('email', email);
  await supabase.from('audit_logs').insert({
    actor_email: email,
    action: 'unpublish_site',
    target_type: 'published_site',
    target_id: site.id,
    metadata: { projectId: site.project_id }
  });
  return c.json({ siteId: site.id, status: 'unpublished' });
});

app.delete('/live-sites/:siteId/deployments/:deploymentId', async (c) => {
  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  const supabase = requireSupabase(c.env);
  const { data: deployment } = await supabase
    .from('site_deployments')
    .select('id,site_id,project_id,provider,provider_deployment_id,status')
    .eq('id', c.req.param('deploymentId'))
    .eq('site_id', c.req.param('siteId'))
    .eq('owner_email', email)
    .maybeSingle();
  if (!deployment) return c.json({ error: 'Deployment not found.' }, 404);
  if (deployment.provider === 'vercel' && deployment.provider_deployment_id) {
    const connection = await getConnection(supabase, c.env, email, 'vercel');
    await deleteVercelDeployment(
      connection,
      String(deployment.provider_deployment_id)
    );
  }
  const now = new Date().toISOString();
  await supabase.from('site_deployments').update({
    status: 'deleted',
    completed_at: now
  }).eq('id', deployment.id).eq('owner_email', email);
  await supabase.from('deployment_events').insert({
    deployment_id: deployment.id,
    site_id: deployment.site_id,
    owner_email: email,
    event_type: 'deployment_deleted',
    status: 'deleted',
    message: 'The authenticated owner deleted this deployment.',
    metadata: {}
  });
  const { data: remaining } = await supabase
    .from('site_deployments')
    .select('id,status,live_url,ready_at')
    .eq('site_id', deployment.site_id)
    .eq('owner_email', email)
    .eq('status', 'ready')
    .order('ready_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabase.from('published_sites').update({
    status: remaining ? 'live' : 'unpublished',
    live_url: remaining?.live_url || null,
    updated_at: now
  }).eq('id', deployment.site_id).eq('owner_email', email);
  if (!remaining) {
    await supabase.from('projects').update({
      status: 'preview_ready',
      production_url: null,
      deployment_state: 'DELETED'
    }).eq('id', deployment.project_id).eq('email', email);
  }
  await supabase.from('audit_logs').insert({
    actor_email: email,
    action: 'delete_deployment',
    target_type: 'site_deployment',
    target_id: deployment.id,
    metadata: { siteId: deployment.site_id }
  });
  return c.json({ deleted: true, deploymentId: deployment.id });
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

async function managedBackendRequestContext(
  c: Context<{ Bindings: Bindings }>
): Promise<{
  supabase: SupabaseClient;
  config: Record<string, any>;
  collection: Record<string, any>;
} | null> {
  const publicKey = c.req.param('key') || '';
  const collectionName = c.req.param('collection') || '';
  if (
    !/^[A-Za-z0-9_-]{32,200}$/.test(publicKey) ||
    !/^[a-z0-9_-]{1,80}$/i.test(collectionName)
  ) {
    return null;
  }
  const supabase = requireSupabase(c.env);
  const keyHash = await sha256Hex(publicKey);
  const { data: access } = await supabase
    .from('managed_backend_access')
    .select('backend_config_id,active')
    .eq('public_key_hash', keyHash)
    .eq('active', true)
    .maybeSingle();
  if (!access) return null;
  const { data: config } = await supabase
    .from('website_backend_configs')
    .select('id,status,mode,backend_plan')
    .eq('id', access.backend_config_id)
    .eq('mode', 'nexora_managed')
    .eq('status', 'verified')
    .maybeSingle();
  if (!config) return null;
  const backendPlan = config.backend_plan as Record<string, any> | null;
  const collections = Array.isArray(backendPlan?.collections)
    ? backendPlan!.collections as Array<Record<string, any>>
    : [];
  const collection = collections.find(
    (item) => String(item.name) === collectionName
  );
  return collection ? { supabase, config, collection } : null;
}

function managedRecordPayload(
  raw: unknown,
  collection: Record<string, any>,
  partial: boolean
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('A JSON record object is required.');
  }
  const record = raw as Record<string, unknown>;
  const fields = Array.isArray(collection.fields)
    ? collection.fields as Array<Record<string, any>>
    : [];
  const allowed = new Map(fields.map((field) => [
    String(field.key),
    field
  ]));
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!allowed.has(key)) continue;
    if (
      value !== null &&
      !['string', 'number', 'boolean'].includes(typeof value) &&
      !Array.isArray(value)
    ) {
      throw new Error(`Field ${key} has an unsupported value.`);
    }
    clean[key] = value;
  }
  if (!partial) {
    for (const field of fields) {
      if (field.required && (clean[String(field.key)] === undefined || clean[String(field.key)] === '')) {
        throw new Error(`Field ${String(field.label || field.key)} is required.`);
      }
    }
  }
  if (!Object.keys(clean).length) {
    throw new Error('No allowed collection fields were provided.');
  }
  return clean;
}

app.get('/public/backends/:key/:collection', async (c) => {
  const context = await managedBackendRequestContext(c);
  if (!context) return c.json({ error: 'Managed backend not found.' }, 404);
  const { data, error } = await context.supabase
    .from('managed_backend_records')
    .select('document_id,payload,created_at,updated_at')
    .eq('backend_config_id', context.config.id)
    .eq('collection_name', c.req.param('collection'))
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return c.json({ error: 'Could not read records.' }, 500);
  return c.json({
    records: (data || []).map((record) => ({
      id: record.document_id,
      ...(record.payload as Record<string, unknown>),
      createdAt: record.created_at,
      updatedAt: record.updated_at
    }))
  });
});

app.post('/public/backends/:key/:collection', async (c) => {
  const context = await managedBackendRequestContext(c);
  if (!context) return c.json({ error: 'Managed backend not found.' }, 404);
  try {
    const payload = managedRecordPayload(
      await c.req.json().catch(() => null),
      context.collection,
      false
    );
    const documentId = crypto.randomUUID();
    const { data, error } = await context.supabase
      .from('managed_backend_records')
      .insert({
        backend_config_id: context.config.id,
        collection_name: c.req.param('collection'),
        document_id: documentId,
        payload
      })
      .select('document_id,payload,created_at,updated_at')
      .single();
    if (error || !data) throw new Error('Could not create the record.');
    return c.json({
      record: {
        id: data.document_id,
        ...(data.payload as Record<string, unknown>),
        createdAt: data.created_at,
        updatedAt: data.updated_at
      }
    }, 201);
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Could not create the record.'
    }, 400);
  }
});

app.patch('/public/backends/:key/:collection/:documentId', async (c) => {
  const context = await managedBackendRequestContext(c);
  if (!context) return c.json({ error: 'Managed backend not found.' }, 404);
  try {
    const patch = managedRecordPayload(
      await c.req.json().catch(() => null),
      context.collection,
      true
    );
    const { data: existing } = await context.supabase
      .from('managed_backend_records')
      .select('payload')
      .eq('backend_config_id', context.config.id)
      .eq('collection_name', c.req.param('collection'))
      .eq('document_id', c.req.param('documentId'))
      .maybeSingle();
    if (!existing) return c.json({ error: 'Record not found.' }, 404);
    const { data, error } = await context.supabase
      .from('managed_backend_records')
      .update({
        payload: {
          ...(existing.payload as Record<string, unknown>),
          ...patch
        },
        updated_at: new Date().toISOString()
      })
      .eq('backend_config_id', context.config.id)
      .eq('collection_name', c.req.param('collection'))
      .eq('document_id', c.req.param('documentId'))
      .select('document_id,payload,created_at,updated_at')
      .maybeSingle();
    if (error || !data) throw new Error('Could not update the record.');
    return c.json({
      record: {
        id: data.document_id,
        ...(data.payload as Record<string, unknown>),
        createdAt: data.created_at,
        updatedAt: data.updated_at
      }
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Could not update the record.'
    }, 400);
  }
});

app.delete('/public/backends/:key/:collection/:documentId', async (c) => {
  const context = await managedBackendRequestContext(c);
  if (!context) return c.json({ error: 'Managed backend not found.' }, 404);
  const { data, error } = await context.supabase
    .from('managed_backend_records')
    .delete()
    .eq('backend_config_id', context.config.id)
    .eq('collection_name', c.req.param('collection'))
    .eq('document_id', c.req.param('documentId'))
    .select('document_id')
    .maybeSingle();
  if (error) return c.json({ error: 'Could not delete the record.' }, 500);
  if (!data) return c.json({ error: 'Record not found.' }, 404);
  return c.json({ deleted: true });
});

app.get('/integrations/firebase/status', async (c) => {
  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  const { data, error } = await requireSupabase(c.env)
    .from('backend_connections')
    .select('status,external_account_name,granted_scopes,token_expires_at,connected_at,updated_at')
    .eq('owner_email', email)
    .eq('provider', 'firebase')
    .maybeSingle();
  if (error) return c.json({ error: 'Could not load Firebase connection status.' }, 500);
  return c.json({
    connected: data?.status === 'connected',
    connection: data || null
  });
});

app.get('/integrations/firebase/start', async (c) => {
  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  if (
    !c.env.FIREBASE_CLIENT_ID ||
    !c.env.FIREBASE_CLIENT_SECRET ||
    !c.env.FIREBASE_REDIRECT_URI ||
    !c.env.TOKEN_ENCRYPTION_KEY
  ) {
    return c.json({ error: 'Firebase OAuth is not configured on the backend.' }, 503);
  }
  const createProject = c.req.query('createProject') === 'true';
  const scopes = [
    'openid',
    'email',
    'https://www.googleapis.com/auth/firebase',
    'https://www.googleapis.com/auth/datastore',
    ...(createProject
      ? ['https://www.googleapis.com/auth/cloud-platform']
      : [])
  ];
  const state = await createOauthState(
    requireSupabase(c.env),
    email,
    'firebase',
    { createProject, scopes }
  );
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', c.env.FIREBASE_CLIENT_ID);
  url.searchParams.set('redirect_uri', c.env.FIREBASE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  return c.json({ url: url.toString(), scopes, createProject });
});

app.get('/integrations/firebase/callback', async (c) => {
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (
      !code ||
      !state ||
      !c.env.FIREBASE_CLIENT_ID ||
      !c.env.FIREBASE_CLIENT_SECRET ||
      !c.env.FIREBASE_REDIRECT_URI
    ) {
      throw new Error('Firebase connection details are missing.');
    }
    const supabase = requireSupabase(c.env);
    const request = await consumeOauthState(supabase, state, 'firebase');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let tokenData: Record<string, any>;
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: c.env.FIREBASE_CLIENT_ID,
          client_secret: c.env.FIREBASE_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: c.env.FIREBASE_REDIRECT_URI
        })
      });
      tokenData = await tokenResponse.json().catch(() => ({})) as Record<string, any>;
      if (!tokenResponse.ok || !tokenData.access_token) {
        throw new Error('Google did not provide a Firebase access token.');
      }
    } finally {
      clearTimeout(timeout);
    }
    const profileResponse = await boundedFetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      }
    );
    const profile = await profileResponse.json().catch(() => ({})) as Record<string, any>;
    if (!profileResponse.ok || !profile.sub) {
      throw new Error('Google account identity could not be verified.');
    }
    const scopes = typeof tokenData.scope === 'string'
      ? tokenData.scope.split(/\s+/).filter(Boolean)
      : Array.isArray(request.metadata?.scopes)
        ? request.metadata!.scopes.filter(
            (scope): scope is string => typeof scope === 'string'
          )
        : [];
    await saveFirebaseConnection(supabase, c.env, {
      email: request.email,
      accessToken: String(tokenData.access_token),
      refreshToken: typeof tokenData.refresh_token === 'string'
        ? tokenData.refresh_token
        : undefined,
      expiresIn: Number(tokenData.expires_in || 3600),
      accountId: String(profile.sub),
      accountName: String(profile.email || 'Google account'),
      scopes
    });
    await supabase.from('audit_logs').insert({
      actor_email: request.email,
      action: 'connect_firebase',
      target_type: 'backend_connection',
      target_id: String(profile.sub),
      metadata: { scopes }
    });
    return c.html('<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;background:#071018;color:white;display:grid;place-items:center;min-height:100vh;text-align:center}div{max-width:440px;padding:32px}h1{color:#22d3ee}</style><div><h1>Firebase connected</h1><p>Return to Nexora.Ai. You can close this page.</p></div>');
  } catch (error) {
    return c.html(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:30px"><h1>Firebase connection failed</h1><p>${escapeHtmlForCallback(error instanceof Error ? error.message : 'Unknown error')}</p></body>`, 400);
  }
});

app.delete('/integrations/firebase', async (c) => {
  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  const supabase = requireSupabase(c.env);
  const { data: connection } = await supabase
    .from('backend_connections')
    .select('id')
    .eq('owner_email', email)
    .eq('provider', 'firebase')
    .maybeSingle();
  let providerRevoked = false;
  if (connection) {
    try {
      const accessToken = await firebaseAccessToken(
        supabase,
        c.env,
        email
      );
      const revoke = await boundedFetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' }
        }
      );
      providerRevoked = revoke.ok;
    } catch {
      providerRevoked = false;
    }
  }
  if (connection) {
    await supabase.from('backend_connections')
      .delete()
      .eq('id', connection.id)
      .eq('owner_email', email);
  }
  await supabase.from('website_backend_configs').update({
    status: 'disconnected',
    connection_id: null,
    updated_at: new Date().toISOString()
  }).eq('owner_email', email).eq('provider', 'firebase');
  await supabase.from('audit_logs').insert({
    actor_email: email,
    action: 'disconnect_firebase',
    target_type: 'backend_connection',
    target_id: connection?.id || null,
    metadata: { providerRevoked }
  });
  return c.json({ disconnected: true, providerRevoked });
});

app.get('/backend/firebase/projects', async (c) => {
  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  try {
    const projects = await listFirebaseProjects(
      await firebaseAccessToken(requireSupabase(c.env), c.env, email)
    );
    return c.json({ projects });
  } catch (error) {
    return c.json({
      error: error instanceof Error
        ? error.message
        : 'Could not load Firebase projects.'
    }, 502);
  }
});

const backendSelectionSchema = z.object({
  mode: z.enum(['none', 'nexora_managed', 'firebase']),
  region: z.enum([
    'us-central1',
    'us-east1',
    'europe-west1',
    'asia-south1',
    'asia-southeast1',
    'australia-southeast1'
  ]),
  isolationMode: z.enum([
    'separate_project',
    'named_database',
    'namespaced'
  ]),
  firebaseProjectId: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/).optional(),
  createProject: z.object({
    projectId: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/),
    displayName: z.string().trim().min(3).max(60)
  }).optional()
}).superRefine((value, context) => {
  if (
    value.mode === 'firebase' &&
    !value.firebaseProjectId &&
    !value.createProject
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Select or create a Firebase project.'
    });
  }
  if (value.firebaseProjectId && value.createProject) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose an existing project or create a new one, not both.'
    });
  }
  if (
    value.mode === 'firebase' &&
    value.isolationMode === 'separate_project' &&
    !value.createProject
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Separate-project isolation requires confirmed creation of a new Firebase project.'
    });
  }
});

app.get('/projects/:id/backend', async (c) => {
  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  const { data, error } = await requireSupabase(c.env)
    .from('website_backend_configs')
    .select('id,mode,provider,status,isolation_mode,external_project_id,external_database_id,namespace,region,backend_plan,safe_public_config,verified_at,verification_details,created_at,updated_at')
    .eq('project_id', c.req.param('id'))
    .eq('owner_email', email)
    .maybeSingle();
  if (error) return c.json({ error: 'Could not load backend setup.' }, 500);
  return c.json({
    backend: data
      ? { ...data, safe_public_config: safeBackendEnvironment(data.safe_public_config) }
      : null
  });
});

app.post('/projects/:id/backend/plan', async (c) => {
  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  const parsed = backendSelectionSchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!parsed.success) {
    return c.json({
      error: parsed.error.issues[0]?.message || 'Valid backend choices are required.'
    }, 400);
  }
  const supabase = requireSupabase(c.env);
  const { data: project } = await supabase
    .from('projects')
    .select('id,name,plan')
    .eq('id', c.req.param('id'))
    .eq('email', email)
    .maybeSingle();
  if (!project) return c.json({ error: 'Project not found.' }, 404);
  const websitePlan = project.plan as WebsitePlan;
  if (!websitePlan.appSpec) {
    return c.json({
      error: 'This legacy project must be regenerated once before backend setup.'
    }, 409);
  }
  const namespace = `nexora-${project.id.replace(/-/g, '').slice(0, 20)}`;
  const plan = isolateBackendProvisioningPlan(
    buildBackendProvisioningPlan(
      websitePlan.appSpec,
      parsed.data
    ),
    namespace
  );
  if (
    parsed.data.mode === 'nexora_managed' &&
    (
      plan.authentication.required ||
      websitePlan.appSpec.realTimeRequired
    )
  ) {
    plan.externalRequirements.push(
      'Nexora-managed storage does not satisfy this project’s authentication or real-time requirements. Select Firebase.'
    );
  }
  const confirmationHash = await backendPlanHash(plan);
  const { data: firebaseConnection } = parsed.data.mode === 'firebase'
    ? await supabase.from('backend_connections')
        .select('id')
        .eq('owner_email', email)
        .eq('provider', 'firebase')
        .eq('status', 'connected')
        .maybeSingle()
    : { data: null };
  if (parsed.data.mode === 'firebase' && !firebaseConnection) {
    return c.json({ error: 'Connect Firebase before creating its backend plan.' }, 409);
  }
  const { data: config, error } = await supabase
    .from('website_backend_configs')
    .upsert({
      owner_email: email,
      project_id: project.id,
      provider: plan.provider,
      connection_id: firebaseConnection?.id || null,
      mode: parsed.data.mode,
      status: 'awaiting_confirmation',
      isolation_mode: parsed.data.isolationMode,
      external_project_id: plan.externalProjectId || plan.createProject?.projectId || null,
      namespace,
      region: parsed.data.region,
      backend_plan: {
        ...plan,
        confirmationHash
      },
      safe_public_config: {},
      verified_at: null,
      verification_details: {},
      updated_at: new Date().toISOString()
    }, { onConflict: 'owner_email,project_id' })
    .select('id')
    .single();
  if (error || !config) return c.json({ error: 'Could not save the backend plan.' }, 500);
  return c.json({
    backendConfigId: config.id,
    plan,
    confirmationHash
  });
});

app.post('/projects/:id/backend/confirm', async (c) => {
  const email = await identityEmail(c.env, c.req.header('Authorization'));
  if (!email) return c.json({ error: 'Your login session is missing or expired.' }, 401);
  const body = z.object({
    confirmationHash: z.string().regex(/^[a-f0-9]{64}$/)
  }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Backend plan confirmation is required.' }, 400);
  const supabase = requireSupabase(c.env);
  const { data: project } = await supabase
    .from('projects')
    .select('id,name,plan')
    .eq('id', c.req.param('id'))
    .eq('email', email)
    .maybeSingle();
  const { data: config } = await supabase
    .from('website_backend_configs')
    .select('*')
    .eq('project_id', c.req.param('id'))
    .eq('owner_email', email)
    .eq('status', 'awaiting_confirmation')
    .maybeSingle();
  if (!project || !config) {
    return c.json({ error: 'Confirmed backend plan not found.' }, 404);
  }
  const stored = { ...(config.backend_plan as Record<string, unknown>) };
  const storedHash = String(stored.confirmationHash || '');
  delete stored.confirmationHash;
  const plan = stored as unknown as BackendProvisioningPlan;
  const computedHash = await backendPlanHash(plan);
  if (
    storedHash !== body.data.confirmationHash ||
    computedHash !== body.data.confirmationHash
  ) {
    return c.json({
      error: 'The backend plan changed after review. Review it again before confirming.'
    }, 409);
  }
  const websitePlan = project.plan as WebsitePlan;
  if (config.mode === 'none') {
    if (websitePlan.appSpec.backend.required) {
      return c.json({
        error: 'This application requires persistence; “No backend required” cannot be verified.'
      }, 409);
    }
    const now = new Date().toISOString();
    await supabase.from('website_backend_configs').update({
      status: 'verified',
      verified_at: now,
      verification_details: {
        mode: 'none',
        reason: 'Binding appSpec does not require persistence.'
      },
      updated_at: now
    }).eq('id', config.id).eq('owner_email', email);
    return c.json({ status: 'verified', mode: 'none', verifiedAt: now });
  }
  if (
    config.mode === 'nexora_managed' &&
    (
      plan.authentication.required ||
      websitePlan.appSpec.realTimeRequired
    )
  ) {
    return c.json({
      error: 'This project requires authentication or real-time subscriptions. Select Firebase for a verifiable backend.'
    }, 409);
  }

  const deploymentStartedAt = new Date().toISOString();
  const { data: backendDeployment, error: deploymentError } = await supabase
    .from('backend_deployments')
    .insert({
      backend_config_id: config.id,
      owner_email: email,
      status: 'provisioning',
      region: config.region,
      started_at: deploymentStartedAt
    })
    .select('id')
    .single();
  if (deploymentError || !backendDeployment) {
    return c.json({ error: 'Could not start backend provisioning.' }, 500);
  }
  await supabase.from('website_backend_configs').update({
    status: 'provisioning',
    updated_at: deploymentStartedAt
  }).eq('id', config.id).eq('owner_email', email);

  try {
    if (config.mode === 'nexora_managed') {
      const publicKey = randomToken();
      const publicKeyHash = await sha256Hex(publicKey);
      await supabase.from('managed_backend_access').upsert({
        backend_config_id: config.id,
        public_key_hash: publicKeyHash,
        active: true
      }, { onConflict: 'backend_config_id' });
      const collection = plan.collections[0]?.name || 'records';
      const verificationId = crypto.randomUUID();
      const { error: writeError } = await supabase
        .from('managed_backend_records')
        .insert({
          backend_config_id: config.id,
          collection_name: collection,
          document_id: verificationId,
          payload: { verification: true }
        });
      if (writeError) throw new Error('Managed backend verification write failed.');
      const { data: readBack } = await supabase
        .from('managed_backend_records')
        .select('document_id,payload')
        .eq('backend_config_id', config.id)
        .eq('collection_name', collection)
        .eq('document_id', verificationId)
        .maybeSingle();
      if (!readBack) throw new Error('Managed backend verification read failed.');
      const { error: cleanupError } = await supabase
        .from('managed_backend_records')
        .delete()
        .eq('backend_config_id', config.id)
        .eq('collection_name', collection)
        .eq('document_id', verificationId);
      if (cleanupError) throw new Error('Managed backend verification cleanup failed.');
      const now = new Date().toISOString();
      const safeConfig = {
        VITE_NEXORA_BACKEND_URL: publicApiBase(c),
        VITE_NEXORA_BACKEND_KEY: publicKey
      };
      await supabase.from('backend_resource_operations').insert({
        backend_config_id: config.id,
        owner_email: email,
        operation_type: 'verify',
        resource_type: 'managed_backend',
        resource_name: config.namespace,
        status: 'completed',
        result_summary: { write: true, read: true, delete: true },
        started_at: deploymentStartedAt,
        completed_at: now
      });
      await supabase.from('website_backend_configs').update({
        status: 'verified',
        safe_public_config: safeConfig,
        verified_at: now,
        verification_details: {
          write: true,
          read: true,
          delete: true
        },
        updated_at: now
      }).eq('id', config.id).eq('owner_email', email);
      await supabase.from('backend_deployments').update({
        status: 'verified',
        verification_write_path: `${collection}/${verificationId}`,
        verification_read_path: `${collection}/${verificationId}`,
        verified_at: now,
        completed_at: now
      }).eq('id', backendDeployment.id);
      await supabase.from('audit_logs').insert({
        actor_email: email,
        action: 'create_managed_backend',
        target_type: 'website_backend_config',
        target_id: config.id,
        metadata: { projectId: project.id, region: config.region }
      });
      return c.json({ status: 'verified', mode: 'nexora_managed', verifiedAt: now });
    }

    const token = await firebaseAccessToken(supabase, c.env, email);
    const result = await provisionFirebaseBackend({
      accessToken: token,
      plan,
      websiteName: project.name,
      namespace: config.namespace
    });
    const now = new Date().toISOString();
    for (const operation of result.operations) {
      await supabase.from('backend_resource_operations').insert({
        backend_config_id: config.id,
        owner_email: email,
        operation_type: operation.type,
        resource_type: operation.resourceType,
        resource_name: operation.resourceName,
        status: operation.status,
        result_summary: operation.result || {},
        error_message: operation.error || null,
        started_at: deploymentStartedAt,
        completed_at: now
      });
    }
    await supabase.from('website_backend_configs').update({
      status: 'verified',
      external_project_id: result.externalProjectId,
      external_database_id: result.databaseId,
      safe_public_config: {
        ...result.safePublicConfig,
        VITE_FIREBASE_DATABASE_ID: result.databaseId === '(default)'
          ? ''
          : result.databaseId,
        VITE_FIREBASE_NAMESPACE: config.isolation_mode === 'namespaced'
          ? config.namespace
          : ''
      },
      verified_at: now,
      verification_details: result.verification,
      updated_at: now
    }).eq('id', config.id).eq('owner_email', email);
    await supabase.from('backend_deployments').update({
      status: 'verified',
      verification_write_path: result.verification.documentPath,
      verification_read_path: result.verification.documentPath,
      verified_at: now,
      completed_at: now
    }).eq('id', backendDeployment.id);
    await supabase.from('audit_logs').insert({
      actor_email: email,
      action: 'provision_firebase_backend',
      target_type: 'website_backend_config',
      target_id: config.id,
      metadata: {
        projectId: project.id,
        firebaseProjectId: result.externalProjectId,
        databaseId: result.databaseId,
        region: config.region
      }
    });
    return c.json({
      status: 'verified',
      mode: 'firebase',
      verifiedAt: now,
      externalProjectId: result.externalProjectId,
      databaseId: result.databaseId,
      operations: result.operations
    });
  } catch (error) {
    const operations = firebaseProviderOperations(error);
    const now = new Date().toISOString();
    for (const operation of operations) {
      await supabase.from('backend_resource_operations').insert({
        backend_config_id: config.id,
        owner_email: email,
        operation_type: operation.type,
        resource_type: operation.resourceType,
        resource_name: operation.resourceName,
        status: operation.status,
        result_summary: operation.result || {},
        error_message: operation.error || null,
        started_at: deploymentStartedAt,
        completed_at: now
      });
    }
    const message = error instanceof Error
      ? error.message
      : 'Backend provisioning failed.';
    await supabase.from('website_backend_configs').update({
      status: operations.some((operation) => operation.status === 'completed')
        ? 'partial'
        : 'failed',
      verification_details: {
        passed: false,
        error: message,
        partialOperations: operations.length
      },
      updated_at: now
    }).eq('id', config.id).eq('owner_email', email);
    await supabase.from('backend_deployments').update({
      status: operations.some((operation) => operation.status === 'completed')
        ? 'partial'
        : 'failed',
      error_message: message,
      completed_at: now
    }).eq('id', backendDeployment.id);
    await supabase.from('audit_logs').insert({
      actor_email: email,
      action: 'firebase_backend_provisioning_failed',
      target_type: 'website_backend_config',
      target_id: config.id,
      metadata: {
        projectId: project.id,
        status: operations.some((operation) => operation.status === 'completed')
          ? 'partial'
          : 'failed',
        operationCount: operations.length
      }
    });
    return c.json({
      error: message,
      status: operations.some((operation) => operation.status === 'completed')
        ? 'partial'
        : 'failed',
      operations
    }, 502);
  }
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
    const tokenResponse = await boundedFetch('https://github.com/login/oauth/access_token', {
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
    const tokenResponse = await boundedFetch('https://api.vercel.com/v2/oauth/access_token', {
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

    const response = await boundedFetch('https://api.vercel.com/v2/user', {
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
app.onError((error, c) => {
  console.error('Unhandled Worker request error.', {
    name: error instanceof Error ? error.name : 'unknown'
  });
  return c.json({ error: 'Unexpected server error.' }, 500);
});

registerAssistantChatRoutes(app, {
  requireUser,
  requireSupabase
});

registerConversationRoutes(app, {
  identity: conversationIdentity,
  requireSupabase
});

registerSubscriptionTokenRoutes(app, {
  requireUser,
  requireAdmin,
  requireSupabase
});
registerPreferenceRoutes(app, {
  authenticatedEmail: (c) =>
    identityEmail(c.env, c.req.header('Authorization')),
  requireSupabase
});
registerLiveSiteReadRoutes(app, {
  authenticatedEmail: (c) =>
    identityEmail(c.env, c.req.header('Authorization')),
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
      Promise.all([
        processCmsSchedules(requireSupabase(env)),
        failStaleGenerationJobs(requireSupabase(env))
      ]).then(([cmsResult, staleJobs]) => {
        console.log('Scheduled maintenance completed', {
          cms: cmsResult,
          staleGenerationJobsClosed: staleJobs
        });
      }).catch((error) => {
        console.error('Scheduled maintenance failed', {
          message: error instanceof Error
            ? error.message
            : 'Unknown scheduled error.'
        });
      })
    );
  }
};
