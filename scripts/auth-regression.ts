import assert from 'node:assert/strict';
import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import api from '../apps/api/src/index';
import { ApiRequestError, requestJson } from '../apps/mobile/src/api-errors';
import {
  resolveRuntimeConfig,
  type RuntimeConfig
} from '../apps/mobile/src/runtime-config';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const tables: Tables = {
  admin_sessions: [],
  user_accounts: [],
  user_sessions: [],
  approved_users: [],
  devices: [],
  audit_logs: []
};

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const adminToken = 'test-admin-session-token';
tables.admin_sessions.push({
  id: randomUUID(),
  token_hash: sha256(adminToken),
  username: 'Poojak@King',
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  revoked_at: null
});

function matches(row: Row, url: URL): boolean {
  for (const [name, raw] of url.searchParams) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(name)) continue;
    const separator = raw.indexOf('.');
    if (separator < 0) continue;
    const operator = raw.slice(0, separator);
    const value = raw.slice(separator + 1);
    const actual = row[name];

    if (operator === 'eq' && String(actual) !== value) return false;
    if (operator === 'neq' && String(actual) === value) return false;
    if (operator === 'is' && value === 'null' && actual != null) return false;
  }

  return true;
}

function responseBody(request: Request, rows: Row[]): BodyInit | null {
  if (request.method === 'HEAD') return null;
  const acceptsObject =
    request.headers.get('accept')?.includes('application/vnd.pgrst.object+json');
  return JSON.stringify(acceptsObject ? rows[0] ?? null : rows);
}

async function fakeSupabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);

  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    return new Response(JSON.stringify({
      message: 'Function is not present in the schema cache.'
    }), { status: 404, headers: { 'content-type': 'application/json' } });
  }

  const tableName = decodeURIComponent(url.pathname.split('/').at(-1) || '');
  const table = tables[tableName] ||= [];
  const headers = new Headers({ 'content-type': 'application/json' });

  if (request.method === 'GET' || request.method === 'HEAD') {
    const rows = table.filter((row) => matches(row, url));
    headers.set('content-range', `0-${Math.max(0, rows.length - 1)}/${rows.length}`);
    return new Response(responseBody(request, rows), { status: 200, headers });
  }

  if (request.method === 'POST') {
    const incoming = await request.json() as Row | Row[];
    const inputRows = Array.isArray(incoming) ? incoming : [incoming];
    const output: Row[] = [];
    const conflictKey = url.searchParams.get('on_conflict');

    for (const item of inputRows) {
      const now = new Date().toISOString();
      const row = {
        id: item.id || randomUUID(),
        created_at: item.created_at || now,
        updated_at: item.updated_at || now,
        ...item
      };
      const existing = conflictKey
        ? table.find((candidate) => candidate[conflictKey] === row[conflictKey])
        : undefined;

      if (existing) {
        Object.assign(existing, row, { id: existing.id });
        output.push(existing);
      } else {
        table.push(row);
        output.push(row);
      }
    }

    const returnsRows = request.headers.get('prefer')?.includes('return=representation');
    const result = returnsRows
      ? inputRows.length === 1 && url.searchParams.has('select')
        ? output[0]
        : output
      : [];
    return new Response(JSON.stringify(result), {
      status: 201,
      headers
    });
  }

  if (request.method === 'PATCH') {
    const update = await request.json() as Row;
    const rows = table.filter((row) => matches(row, url));
    rows.forEach((row) => Object.assign(row, update));
    return new Response(JSON.stringify([]), { status: 200, headers });
  }

  if (request.method === 'DELETE') {
    const removed = table.filter((row) => matches(row, url));
    tables[tableName] = table.filter((row) => !matches(row, url));
    return new Response(JSON.stringify(removed), { status: 200, headers });
  }

  return new Response(JSON.stringify({ message: 'Unsupported fake request.' }), {
    status: 500,
    headers
  });
}

const testAdminPassword = `${randomUUID()}Aa1`;
const testAdminSalt = randomBytes(16).toString('hex');
const testAdminIterations = 1000;

const env = {
  APP_NAME: 'Nexora test',
  SUPABASE_URL: 'https://auth-test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ADMIN_USERNAME: 'Poojak@King',
  ADMIN_PASSWORD_SALT: testAdminSalt,
  ADMIN_PASSWORD_HASH: pbkdf2Sync(
    testAdminPassword,
    Buffer.from(testAdminSalt, 'hex'),
    testAdminIterations,
    32,
    'sha256'
  ).toString('hex'),
  ADMIN_PASSWORD_ITERATIONS: String(testAdminIterations)
};
const executionContext = {
  waitUntil() {},
  passThroughOnException() {}
};

async function apiRequest(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return api.fetch(
    new Request(`https://api.test${path}`, init),
    env,
    executionContext
  );
}

async function jsonRequest(
  path: string,
  body: Row,
  token?: string,
  method = 'POST'
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await apiRequest(path, {
    method,
    headers,
    body: JSON.stringify(body)
  });
  const data = await response.json() as Row;
  return { response, data };
}

async function runAdminAuthenticationRegression() {
  const normalRoute = await jsonRequest('/auth/login', {
    username: env.ADMIN_USERNAME,
    password: testAdminPassword,
    installationId: randomUUID()
  });
  assert.equal(normalRoute.response.status, 400);
  assert.equal(
    normalRoute.data.error,
    'Enter a valid username and password.'
  );

  const rejected = await jsonRequest('/admin/auth/login', {
    username: env.ADMIN_USERNAME,
    password: `${testAdminPassword}x`
  });
  assert.equal(rejected.response.status, 401);
  assert.equal(
    rejected.data.error,
    'Invalid admin username or password.'
  );

  const accepted = await jsonRequest('/admin/auth/login', {
    username: env.ADMIN_USERNAME,
    password: testAdminPassword
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.username, env.ADMIN_USERNAME);
  assert.ok(accepted.data.token);
  assert.ok(accepted.data.expiresAt);
  assert.ok(
    tables.admin_sessions.some(
      (session) => session.token_hash === sha256(accepted.data.token)
    ),
    'accepted admin credentials create a persisted session'
  );

  const dashboard = await apiRequest('/admin/summary', {
    headers: { Authorization: `Bearer ${accepted.data.token}` }
  });
  assert.equal(dashboard.status, 200, 'new admin session authorizes the dashboard');

  const appSource = readFileSync(
    resolve(import.meta.dirname, '../apps/mobile/src/App.tsx'),
    'utf8'
  );
  assert.match(
    appSource,
    /mode === 'admin-login' \|\| mode === 'admin-dashboard'/,
    'admin-login mode renders the dedicated AdminPanelV5 login flow'
  );
}

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeSupabaseFetch as typeof fetch;

  try {
  await runAdminAuthenticationRegression();

  if (process.argv.includes('--admin-only')) {
    console.log('Admin authentication regression tests passed.');
    return;
  }

  const preflight = await apiRequest('/admin/accounts/account-id/password', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://localhost',
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers': 'authorization,content-type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /PATCH/);

  const unauthorizedReset = await jsonRequest(
    '/admin/accounts/missing/password',
    { password: 'ResetPassword2' },
    undefined,
    'PATCH'
  );
  assert.equal(unauthorizedReset.response.status, 401);

  const created = await jsonRequest(
    '/admin/accounts/create',
    { username: '  Case   User  ', password: 'OldPassword1' },
    adminToken
  );
  assert.equal(created.response.status, 200);
  assert.equal(
    created.data.account?.username,
    'case.user',
    JSON.stringify(created.data)
  );

  const deviceOne = '11111111-1111-4111-8111-111111111111';
  const deviceTwo = '22222222-2222-4222-8222-222222222222';
  const deviceThree = '33333333-3333-4333-8333-333333333333';
  const loginBody = {
    username: ' CASE    USER ',
    password: 'OldPassword1',
    installationId: deviceOne
  };
  const firstLogin = await jsonRequest('/auth/login', loginBody);
  assert.equal(firstLogin.response.status, 200);
  assert.ok(firstLogin.data.token);

  const restored = await apiRequest('/auth/me', {
    headers: { Authorization: `Bearer ${firstLogin.data.token}` }
  });
  assert.equal(restored.status, 200, 'stored session restores after restart');

  const cacheClearedLogin = await jsonRequest('/auth/login', loginBody);
  assert.equal(cacheClearedLogin.response.status, 200, 'remote account survives client cache clearing');

  const cleanClientLogin = await jsonRequest('/auth/login', {
    ...loginBody,
    installationId: deviceTwo
  });
  assert.equal(cleanClientLogin.response.status, 200, 'second clean client can log in');

  const deviceLimit = await jsonRequest('/auth/login', {
    ...loginBody,
    installationId: deviceThree
  });
  assert.equal(deviceLimit.response.status, 409);
  assert.match(deviceLimit.data.error, /Device limit reached/);

  const wrongPassword = await jsonRequest('/auth/login', {
    ...loginBody,
    password: 'WrongPassword9'
  });
  assert.equal(wrongPassword.response.status, 401);

  const weakPassword = await jsonRequest(
    '/auth/password',
    { currentPassword: 'OldPassword1', newPassword: 'short' },
    cacheClearedLogin.data.token,
    'PATCH'
  );
  assert.equal(weakPassword.response.status, 400);

  const incorrectCurrent = await jsonRequest(
    '/auth/password',
    { currentPassword: 'WrongPassword9', newPassword: 'NewPassword2' },
    cacheClearedLogin.data.token,
    'PATCH'
  );
  assert.equal(incorrectCurrent.response.status, 400);

  const account = tables.user_accounts[0];
  const expiredToken = 'expired-session-token';
  tables.user_sessions.push({
    id: randomUUID(),
    user_id: account.id,
    username: account.username,
    internal_email: account.internal_email,
    token_hash: sha256(expiredToken),
    expires_at: new Date(Date.now() - 1000).toISOString(),
    revoked_at: null
  });
  const expiredChange = await jsonRequest(
    '/auth/password',
    { currentPassword: 'OldPassword1', newPassword: 'NewPassword2' },
    expiredToken,
    'PATCH'
  );
  assert.equal(expiredChange.response.status, 401);

  const changed = await jsonRequest(
    '/auth/password',
    { currentPassword: 'OldPassword1', newPassword: 'NewPassword2' },
    cacheClearedLogin.data.token,
    'PATCH'
  );
  assert.equal(changed.response.status, 200);

  const currentSessionStillValid = await apiRequest('/auth/me', {
    headers: { Authorization: `Bearer ${cacheClearedLogin.data.token}` }
  });
  assert.equal(currentSessionStillValid.status, 200);
  const otherSessionRevoked = await apiRequest('/auth/me', {
    headers: { Authorization: `Bearer ${cleanClientLogin.data.token}` }
  });
  assert.equal(otherSessionRevoked.status, 401);

  const oldRejected = await jsonRequest('/auth/login', loginBody);
  assert.equal(oldRejected.response.status, 401, 'old password stops working');
  const newAccepted = await jsonRequest('/auth/login', {
    ...loginBody,
    password: 'NewPassword2'
  });
  assert.equal(newAccepted.response.status, 200, 'new password works immediately');

  const accountId = account.id;
  const adminReset = await jsonRequest(
    `/admin/accounts/${accountId}/password`,
    { password: 'AdminReset3' },
    adminToken,
    'PATCH'
  );
  assert.equal(adminReset.response.status, 200);
  assert.equal(
    tables.user_sessions.filter((session) => session.user_id === accountId).length,
    0,
    'admin reset revokes all sessions'
  );

  const resetAccepted = await jsonRequest('/auth/login', {
    ...loginBody,
    password: 'AdminReset3'
  });
  assert.equal(resetAccepted.response.status, 200);

  account.status = 'disabled';
  const disabledRejected = await jsonRequest('/auth/login', {
    ...loginBody,
    password: 'AdminReset3'
  });
  assert.equal(disabledRejected.response.status, 401);

  account.status = 'active';
  const deleted = await apiRequest(`/admin/accounts/${accountId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(deleted.status, 200);
  const deletedRejected = await jsonRequest('/auth/login', {
    ...loginBody,
    password: 'AdminReset3'
  });
  assert.equal(deletedRejected.response.status, 401);

  const bundled: RuntimeConfig = {
    apiBase: 'https://api.production.test',
    supabaseUrl: 'https://project.production.supabase.co',
    supabaseAnonKey: 'publishable-production-key-value'
  };
  const staleStored = JSON.stringify({
    apiBase: 'https://stale-api.test',
    supabaseUrl: 'https://stale-project.supabase.co',
    supabaseAnonKey: 'publishable-stale-key-value'
  });
  assert.deepEqual(
    resolveRuntimeConfig(bundled, staleStored, false),
    bundled,
    'production ignores stale installation-specific backend overrides'
  );
  assert.equal(
    resolveRuntimeConfig(bundled, staleStored, true).apiBase,
    'https://stale-api.test',
    'development can still use an explicit local backend'
  );

  const productionEnv = readFileSync(
    resolve(import.meta.dirname, '../apps/mobile/.env.production'),
    'utf8'
  );
  const workerConfig = readFileSync(
    resolve(import.meta.dirname, '../apps/api/wrangler.toml'),
    'utf8'
  );
  const apiUrl = productionEnv.match(/^VITE_API_BASE_URL=(.+)$/m)?.[1];
  const workerName = workerConfig.match(/^name\s*=\s*"([^"]+)"$/m)?.[1];
  assert.ok(apiUrl && workerName);
  assert.equal(new URL(apiUrl).hostname.split('.')[0], workerName);
  assert.doesNotMatch(productionEnv, /YOUR-|localhost|127\.0\.0\.1/);

  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  await assert.rejects(
    () => requestJson('https://unavailable.test/auth/password'),
    (error: unknown) =>
      error instanceof ApiRequestError && error.kind === 'network'
  );

  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: 'Too many requests.' }),
    { status: 429, headers: { 'content-type': 'application/json' } }
  )) as typeof fetch;
  await assert.rejects(
    () => requestJson('https://rate-limit.test/auth/password'),
    (error: unknown) =>
      error instanceof ApiRequestError && error.kind === 'rate-limit'
  );

  for (const [status, kind] of [
    [401, 'unauthorized'],
    [400, 'validation'],
    [500, 'server']
  ] as const) {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: `Server response ${status}` }),
      { status, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
    await assert.rejects(
      () => requestJson('https://classification.test/auth/password'),
      (error: unknown) =>
        error instanceof ApiRequestError && error.kind === kind
    );
  }

    console.log('Authentication regression tests passed.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
