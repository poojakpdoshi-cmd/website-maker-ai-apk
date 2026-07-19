import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiRequestError } from '../apps/mobile/src/api-errors';
import { loginAdmin, loginNormalUser } from '../apps/mobile/src/auth-routing';

type RecordedRequest = {
  url: string;
  method: string;
  body: Record<string, unknown>;
};

const requests: RecordedRequest[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const body = typeof init?.body === 'string'
    ? JSON.parse(init.body) as Record<string, unknown>
    : {};

  requests.push({
    url,
    method: init?.method || 'GET',
    body
  });

  if (url.endsWith('/admin/auth/login')) {
    if (body.password === 'rejected-test-password') {
      return Response.json(
        { error: 'Genuine admin rejection from backend.' },
        { status: 401 }
      );
    }

    return Response.json({
      token: 'test-admin-session',
      expiresAt: '2099-01-01T00:00:00.000Z',
      username: body.username
    });
  }

  if (url.endsWith('/auth/login')) {
    return Response.json({
      token: 'test-user-session',
      expiresAt: '2099-01-01T00:00:00.000Z',
      username: body.username,
      internalEmail: 'user-id@nexora.internal',
      approved: true,
      role: 'subscriber',
      maxDevices: 1,
      activeDevices: 1
    });
  }

  return Response.json({ error: 'Unexpected test route.' }, { status: 404 });
};

async function main() {
  try {
    await loginNormalUser('https://api.test', {
      username: 'normal-user',
      password: 'normal-test-password',
      installationId: 'installation-test-id',
      deviceName: 'test-device',
      androidVersion: 'test-runtime'
    });

    assert.deepEqual(
      requests.map(({ url, method }) => ({ url, method })),
      [{ url: 'https://api.test/auth/login', method: 'POST' }],
      'normal user login calls only POST /auth/login'
    );

    requests.length = 0;
    await loginAdmin('https://api.test', {
      username: 'admin@example.test',
      password: 'admin-test-password'
    });

    assert.deepEqual(
      requests.map(({ url, method }) => ({ url, method })),
      [{ url: 'https://api.test/admin/auth/login', method: 'POST' }],
      'admin login calls only POST /admin/auth/login'
    );
    assert.equal(
      requests.some(({ url, body }) =>
        new URL(url).pathname === '/auth/login' &&
        String(body.username).includes('@')
      ),
      false,
      'an admin username containing @ never reaches the normal-user endpoint'
    );

    requests.length = 0;
    await assert.rejects(
      loginAdmin('https://api.test', {
        username: 'admin@example.test',
        password: 'rejected-test-password'
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiRequestError);
        assert.equal(error.status, 401);
        assert.equal(error.message, 'Genuine admin rejection from backend.');
        return true;
      },
      'failed admin login preserves the genuine backend response'
    );

    const root = resolve(import.meta.dirname, '..');
    const appSource = readFileSync(
      resolve(root, 'apps/mobile/src/App.tsx'),
      'utf8'
    );
    const adminSource = readFileSync(
      resolve(root, 'apps/mobile/src/AdminPanelV5.tsx'),
      'utf8'
    );

    const normalHandler = appSource.slice(
      appSource.indexOf('async function handleUsernameLogin'),
      appSource.indexOf('function handleAdminMode')
    );
    assert.match(normalHandler, /loginNormalUser\(config\.apiBase, loginPayload\)/);
    assert.doesNotMatch(normalHandler, /loginAdmin|admin\/auth\/login/);

    assert.match(appSource, /const adminLoginPath = '\/admin\/auth\/login'/);
    assert.match(appSource, /function initialAppMode\(\)[\s\S]*?adminLoginPath[\s\S]*?'admin-login'/);
    assert.doesNotMatch(appSource, /openAdminLogin|Owner controls|Admin Access|Open Admin/);
    assert.match(appSource, /mode === 'admin-login' \|\| mode === 'admin-dashboard'/);

    const adminLoginHandler = adminSource.slice(
      adminSource.indexOf('async function login('),
      adminSource.indexOf('async function createUser')
    );
    assert.match(adminLoginHandler, /loginAdmin\(apiBase/);
    assert.doesNotMatch(adminLoginHandler, /loginNormalUser|['"`]\/auth\/login/);
    assert.match(adminLoginHandler, /await loadDashboard\(data\.token\);\s*onMode\('admin-dashboard'\)/);
    assert.match(adminLoginHandler, /loginError instanceof Error\s*\? loginError\.message/);

    assert.match(adminSource, /function returnToApp\(\)[\s\S]*?setError\(''\)[\s\S]*?setMessage\(''\)[\s\S]*?onMode\('user'\)/);
    assert.match(adminSource, /onClick=\{returnToApp\}[\s\S]*?>\s*Return to App\s*<\/button>/);
    assert.match(adminSource, /async function logout\(\)[\s\S]*?admin\/auth\/logout[\s\S]*?localStorage\.removeItem\(adminSessionKey\);\s*setToken\(''\);[\s\S]*?onMode\('user'\)/);
    assert.match(adminSource, /controller\.abort\(\)/);
    assert.match(appSource, /setForceUserLogin\(nextMode === 'user'\)/);
    assert.match(adminSource, />\s*Exit Admin Panel\s*<\/button>/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Dedicated admin routing regression tests passed.');
}

void main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
