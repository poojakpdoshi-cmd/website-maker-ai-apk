import assert from 'node:assert/strict';
import {
  ArceeProviderError,
  askArcee
} from '../apps/api/src/arcee-provider';

async function expectCategory(
  promise: Promise<unknown>,
  category: string
): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof ArceeProviderError &&
      error.category === category
  );
}

async function main(): Promise<void> {
await expectCategory(
  askArcee(
    { apiKey: 'mock-key', model: '' },
    'system',
    [],
    (() => {
      throw new Error('Fetch must not run for invalid config.');
    }) as typeof fetch
  ),
  'configuration'
);

let retryCalls = 0;
const seenAuthorizations: string[] = [];
const retryingFetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  assert.equal(String(input), 'https://models.arcee.ai/v1/chat/completions');
  retryCalls += 1;
  seenAuthorizations.push(new Headers(init?.headers).get('authorization') || '');
  if (retryCalls === 1) {
    return new Response('{}', { status: 429 });
  }
  return new Response(
    JSON.stringify({
      model: 'verified-model-from-response',
      choices: [{
        message: { content: 'Mocked answer' },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 3,
        total_tokens: 11
      }
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }
  );
}) as typeof fetch;

const reply = await askArcee(
  {
    apiKey: 'mock-key',
    model: 'configured-test-model',
    maxAttempts: 2
  },
  'system',
  [{ role: 'user', content: 'Hello' }],
  retryingFetch
);
assert.equal(retryCalls, 2);
assert.deepEqual(seenAuthorizations, [
  'Bearer mock-key',
  'Bearer mock-key'
]);
assert.equal(reply.reply, 'Mocked answer');
assert.equal(reply.finishReason, 'stop');
assert.equal(reply.model, 'verified-model-from-response');
assert.deepEqual(reply.usage, {
  inputTokens: 8,
  outputTokens: 3,
  totalTokens: 11
});

let authenticationCalls = 0;
await expectCategory(
  askArcee(
    {
      apiKey: 'mock-key',
      model: 'configured-test-model',
      maxAttempts: 2
    },
    'system',
    [],
    (async () => {
      authenticationCalls += 1;
      return new Response('{}', { status: 401 });
    }) as typeof fetch
  ),
  'authentication'
);
assert.equal(authenticationCalls, 1, 'Authentication failures must not retry.');

await expectCategory(
  askArcee(
    { apiKey: 'mock-key', model: 'configured-test-model' },
    'system',
    [],
    (async () =>
      new Response('{', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })) as typeof fetch
  ),
  'malformed_response'
);

console.log('Arcee provider mocked regression checks passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
