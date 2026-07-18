const fs = require('fs');
const path = require('path');
const assert = require('assert');

const apiRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(apiRoot, '..', '..');
const ts = require(
  require.resolve('typescript', { paths: [apiRoot] })
);

const source = fs.readFileSync(
  path.join(apiRoot, 'src/thinkmax.ts'),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const moduleContainer = { exports: {} };
const apiRequire = (request) => require(
  require.resolve(request, { paths: [apiRoot] })
);

new Function('exports', 'module', 'require', compiled)(
  moduleContainer.exports,
  moduleContainer,
  apiRequire
);

const {
  parseThinkMaxRefinement,
  runOptionalThinkMax,
  thinkMaxFlagSchema
} = moduleContainer.exports;

const plan = {
  businessName: 'Test Studio',
  websiteType: 'business',
  tagline: 'A clear digital home for Test Studio',
  pages: ['home', 'services', 'contact'],
  features: ['contact-form'],
  theme: {
    style: 'modern professional',
    primary: '#3155d9',
    secondary: '#13b8a6',
    background: '#f7f9ff',
    text: '#16203a'
  },
  sections: [
    { title: 'A clear introduction', body: 'Explain the offer and primary action clearly.' },
    { title: 'Useful services', body: 'Present the services around customer needs.' },
    { title: 'A reliable process', body: 'Show how the team delivers the work.' },
    { title: 'Start a conversation', body: 'Provide an accessible contact path.' }
  ],
  contact: { email: 'hello@example.com' }
};

const validRefinement = {
  refinedPlan: {
    ...plan,
    tagline: 'A refined digital home for Test Studio'
  },
  architectureBrief:
    'Use semantic sections, a focused conversion path, responsive layout, and accessible interactive states.',
  reviewSummary:
    'The plan was refined for hierarchy, accessibility, and implementation clarity.'
};

async function main() {
  assert.strictEqual(thinkMaxFlagSchema.parse(undefined), undefined);
  assert.strictEqual(thinkMaxFlagSchema.parse(false), false);
  assert.strictEqual(thinkMaxFlagSchema.parse(true), true);
  assert.strictEqual(thinkMaxFlagSchema.safeParse('true').success, false);

  let calls = 0;
  const standard = await runOptionalThinkMax(
    false,
    { request: 'Create a detailed business website.', plan },
    async () => {
      calls += 1;
      return JSON.stringify(validRefinement);
    }
  );

  assert.strictEqual(calls, 0, 'Standard generation invoked ThinkMax.');
  assert.strictEqual(standard.plan, plan, 'Standard plan changed.');
  assert.strictEqual(standard.completed, false);

  const enhanced = await runOptionalThinkMax(
    true,
    { request: 'Create a detailed business website.', plan },
    async () => {
      calls += 1;
      return JSON.stringify(validRefinement);
    }
  );

  assert.strictEqual(calls, 1, 'ThinkMax did not invoke exactly one extra pass.');
  assert.strictEqual(enhanced.completed, true);
  assert.strictEqual(
    enhanced.plan.tagline,
    validRefinement.refinedPlan.tagline
  );
  assert.deepStrictEqual(
    enhanced.plan.contact,
    plan.contact,
    'ThinkMax must preserve the original validated contact data.'
  );
  assert.ok(enhanced.architectureBrief.length >= 40);

  assert.throws(
    () => parseThinkMaxRefinement(JSON.stringify({
      ...validRefinement,
      reasoning: 'private reasoning must never be accepted'
    })),
    /unrecognized|validation|parse/i
  );

  await assert.rejects(
    runOptionalThinkMax(
      true,
      { request: 'Create a detailed business website.', plan },
      async () => {
        throw new Error('private provider detail');
      }
    ),
    (error) =>
      error instanceof Error &&
      error.message ===
        'ThinkMax advanced planning could not be completed.' &&
      !error.message.includes('private provider detail')
  );

  const apiSource = fs.readFileSync(
    path.join(apiRoot, 'src/index.ts'),
    'utf8'
  );
  const appSource = fs.readFileSync(
    path.join(repositoryRoot, 'apps/mobile/src/App.tsx'),
    'utf8'
  );
  const chatSource = fs.readFileSync(
    path.join(repositoryRoot, 'apps/mobile/src/ChatStudio.tsx'),
    'utf8'
  );

  assert.ok(
    (apiSource.match(/thinkMax: thinkMaxFlagSchema/g) || []).length >= 2,
    'Both generation request schemas must validate ThinkMax.'
  );
  assert.ok(apiSource.includes('thinkMax: parsed.data.thinkMax'));
  assert.ok(apiSource.includes('runThinkMaxPlanningAgent'));
  assert.ok(
    apiSource.includes(".eq('status', 'queued')"),
    'A queued generation job must be claimed atomically.'
  );
  assert.ok(
    apiSource.includes("? 'thinkmax'") &&
      apiSource.includes(": 'auto'"),
    'The requested workflow mode must be recorded.'
  );
  assert.ok(!apiSource.includes('reviewSummary: thinkMaxResult.reviewSummary'));
  assert.ok(
    appSource.includes(
      'const [thinkMaxEnabled, setThinkMaxEnabled] = useState(false);'
    ),
    'ThinkMax must default to off.'
  );
  assert.ok(
    appSource.includes('thinkMaxEnabled ? { thinkMax: true } : {}'),
    'Enabled requests must send a boolean and disabled requests must omit it.'
  );
  assert.ok(appSource.includes('generationInFlightRef.current'));
  assert.ok(
    appSource.includes(
      'async function resumeGeneration(): Promise<void> {\n      generationInFlightRef.current = true;'
    ),
    'Resumed generation must activate the duplicate-call guard.'
  );
  assert.ok(chatSource.includes('type="checkbox"'));
  assert.ok(chatSource.includes('websiteBuildRequest && (busy || buildActive)'));

  console.log('SUCCESS: ThinkMax contract and flow tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
