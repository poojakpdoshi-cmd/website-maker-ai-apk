import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeGenerationStatus } from '../apps/mobile/src/generation-job';

const root = resolve(import.meta.dirname, '..');
const app = readFileSync(resolve(root, 'apps/mobile/src/App.tsx'), 'utf8');
const chat = readFileSync(
  resolve(root, 'apps/mobile/src/ChatStudio.tsx'),
  'utf8'
);
const api = readFileSync(resolve(root, 'apps/api/src/index.ts'), 'utf8');
const assistant = readFileSync(
  resolve(root, 'apps/api/src/assistant-chat.ts'),
  'utf8'
);

assert.equal(normalizeGenerationStatus('queued'), 'queued');
assert.equal(normalizeGenerationStatus('RUNNING'), 'running');
assert.equal(normalizeGenerationStatus('completed'), 'completed');
assert.equal(normalizeGenerationStatus('failed'), 'failed');
assert.equal(normalizeGenerationStatus('cancelled'), 'cancelled');
assert.equal(normalizeGenerationStatus('canceled'), 'cancelled');
assert.equal(normalizeGenerationStatus('paused'), 'unknown');

const startRoute = api.slice(
  api.indexOf("app.post('/generation-jobs/start'"),
  api.indexOf("app.get('/generation-jobs/:id'")
);
assert.doesNotMatch(
  startRoute,
  /waitUntil|app\.fetch\(/,
  'the 202 response must not detach generation into a short-lived waitUntil task'
);
assert.match(app, /fetch\(`\$\{config\.apiBase\}\/generate`/);
assert.match(app, /saveGenerationLaunch\(/);
assert.match(app, /loadGenerationLaunch\(/);
assert.match(app, /normalizeGenerationStatus\(data\.job\.status\)/);
assert.match(app, /state === 'cancelled'/);
assert.match(app, /state === 'unknown'/);
assert.match(app, /Connection interrupted\. Reconnecting to the saved task/);
assert.match(app, /controller\.abort\(\)/);
assert.match(app, /The generation status request timed out\./);
assert.match(app, /setTab\('preview'\)/);

const newChat = chat.slice(
  chat.indexOf('function newChat()'),
  chat.indexOf('function selectAttachment')
);
assert.doesNotMatch(newChat, /location\.reload|active-generation-job/);
assert.match(chat, /function appendMessageToChat\(/);
assert.match(chat, /activeChatIdRef\.current === chatId/);
assert.match(chat, /createdAt: new Date\(\)\.toISOString\(\)/);
assert.match(chat, /Processing time unavailable/);
assert.match(chat, /Token usage unavailable/);
assert.match(chat, /normalizeSavedChats/);

assert.match(assistant, /processingDurationMs/);
assert.match(assistant, /usageMetadata/);
assert.match(assistant, /usage\?\.total_tokens/);
assert.doesNotMatch(assistant, /WebForge|Website Maker AI/i);

console.log('Generation, chat metadata and new-chat regression tests passed.');
