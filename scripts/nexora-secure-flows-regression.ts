import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerConversationRoutes } from '../apps/api/src/conversation-routes';
import { registerSubscriptionTokenRoutes } from '../apps/api/src/subscription-tokens';

const root = resolve(import.meta.dirname, '..');
const read = (path: string): string =>
  readFileSync(resolve(root, path), 'utf8');

const assistant = read('apps/api/src/assistant-chat.ts');
const conversations = read('apps/api/src/conversation-routes.ts');
const arcee = read('apps/api/src/arcee-provider.ts');
const tokens = read('apps/api/src/subscription-tokens.ts');
const generation = read('apps/api/src/index.ts');
const conversationMigration = read(
  'supabase/migrations/012_conversations_timing_security.sql'
);
const tokenMigration = read(
  'supabase/migrations/013_non_expiring_token_packages.sql'
);

assert.match(assistant, /Authentication required/);
assert.match(assistant, /identity: \(c: any\)/);
assert.doesNotMatch(assistant, /body\.email|body\.accountId|body\.ownerId/);
assert.match(assistant, /beginConversationTurn/);
assert.match(assistant, /chat:\$\{body\.idempotencyKey\}/);
assert.match(assistant, /failConversationTurn/);
assert.match(assistant, /refundNexoraTokens/);
assert.match(assistant, /configuredProvider === "arcee"/);
assert.doesNotMatch(
  generation,
  /askArcee/,
  'Website generation must not call the Arcee Q&A adapter.'
);

for (const protectedRoute of [
  'app.get("/conversations"',
  'app.post("/conversations"',
  'app.get("/conversations/:id/messages"',
  'app.patch("/conversations/:id"',
  'app.delete("/conversations/:id"'
]) {
  const start = conversations.indexOf(protectedRoute);
  assert.ok(start >= 0, `${protectedRoute} must exist.`);
  assert.match(
    conversations.slice(start, start + 500),
    /const identity = await deps\.identity\(c\)/
  );
}
assert.match(conversations, /\.eq\("account_id", identity\.accountId\)/);
assert.match(conversations, /Conversation not found/);
assert.match(conversations, /nexora_check_rate_limit/);
assert.match(conversations, /limit: pageLimit/);
assert.match(conversations, /Request body is too large/);

assert.match(conversationMigration, /force row level security/gi);
assert.match(conversationMigration, /unique \(account_id, idempotency_key\)/);
assert.match(conversationMigration, /pg_advisory_xact_lock/);
assert.match(conversationMigration, /nexora_begin_conversation_turn/);
assert.match(conversationMigration, /nexora_fail_conversation_turn/);
assert.match(conversationMigration, /duration_ms/);
assert.match(conversationMigration, /from public, anon, authenticated/);

assert.match(tokens, /deps\.requireAdmin\(c\)/);
assert.match(tokens, /idempotencyKey/);
assert.match(tokens, /reason/);
assert.doesNotMatch(tokens, /p_cycle_end|tokenAdjustment/);
assert.match(tokenMigration, /token_transactions_no_update/);
assert.match(tokenMigration, /unique \(account_id, idempotency_key\)/);
assert.match(tokenMigration, /pg_advisory_xact_lock/);
assert.match(tokenMigration, /nexora_grant_token_package/);
assert.match(tokenMigration, /nexora_grant_admin_bonus/);
assert.match(tokenMigration, /internal-failure-refund:/);
assert.match(tokenMigration, /on conflict \(account_id, idempotency_key\) do nothing/);
assert.match(tokenMigration, /recurring = false/);
assert.match(tokenMigration, /reset_at = null/);
assert.doesNotMatch(
  arcee,
  /console\.(log|error)|ARCEE_API_KEY|Bearer\s+[A-Za-z0-9_-]{16,}/
);

console.log(
  'Conversation ownership, authorization, idempotency and token-ledger regression checks passed.'
);

type Handler = (context: any) => Promise<any>;

function context(pathId = '11111111-1111-4111-8111-111111111111') {
  return {
    env: {},
    req: {
      query: () => undefined,
      param: () => pathId,
      header: () => undefined
    },
    json: (body: unknown, status = 200) => ({ body, status }),
    header: () => undefined
  };
}

async function behavioralAuthorizationChecks(): Promise<void> {
  const routes = new Map<string, Handler>();
  const app = {
    get: (path: string, handler: Handler) => routes.set(`GET ${path}`, handler),
    post: (path: string, handler: Handler) => routes.set(`POST ${path}`, handler),
    patch: (path: string, handler: Handler) => routes.set(`PATCH ${path}`, handler),
    delete: (path: string, handler: Handler) => routes.set(`DELETE ${path}`, handler)
  };

  registerConversationRoutes(app, {
    identity: async () => null,
    requireSupabase: () => {
      throw new Error('Unauthenticated requests must not reach the database.');
    }
  });
  const unauthenticated = await routes.get('GET /conversations')!(context());
  assert.equal(unauthenticated.status, 401);

  const isolatedRoutes = new Map<string, Handler>();
  const isolatedApp = {
    ...app,
    get: (path: string, handler: Handler) =>
      isolatedRoutes.set(`GET ${path}`, handler),
    post: (path: string, handler: Handler) =>
      isolatedRoutes.set(`POST ${path}`, handler),
    patch: (path: string, handler: Handler) =>
      isolatedRoutes.set(`PATCH ${path}`, handler),
    delete: (path: string, handler: Handler) =>
      isolatedRoutes.set(`DELETE ${path}`, handler)
  };
  const missingOwnerRow = {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    maybeSingle: async () => ({ data: null, error: null })
  };
  registerConversationRoutes(isolatedApp, {
    identity: async () => ({
      accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'owner-a@example.invalid',
      username: 'owner-a'
    }),
    requireSupabase: () => ({
      from: () => missingOwnerRow,
      rpc: async () => ({
        data: { allowed: true, retryAfterSeconds: 1 },
        error: null
      })
    }) as any
  });
  const crossUser = await isolatedRoutes.get(
    'GET /conversations/:id/messages'
  )!(context());
  assert.equal(crossUser.status, 404);

  const adminRoutes = new Map<string, Handler>();
  registerSubscriptionTokenRoutes({
    get: () => undefined,
    patch: (path: string, handler: Handler) =>
      adminRoutes.set(`PATCH ${path}`, handler)
  }, {
    requireAdmin: async () => false,
    requireUser: async () => null,
    requireSupabase: () => {
      throw new Error('Non-admin grants must not reach the database.');
    }
  });
  const nonAdmin = await adminRoutes.get(
    'PATCH /admin/accounts/:id/billing'
  )!(context());
  assert.equal(nonAdmin.status, 401);
}

void behavioralAuthorizationChecks()
  .then(() => {
    console.log(
      'Unauthenticated, cross-user and non-admin route checks passed.'
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
