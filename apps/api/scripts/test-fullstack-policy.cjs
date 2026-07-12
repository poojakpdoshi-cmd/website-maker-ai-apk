const fs = require('fs');
const path = require('path');
const assert = require('assert');

const apiRoot = path.resolve(__dirname, '..');
const ts = require(
  require.resolve('typescript', {
    paths: [apiRoot]
  })
);

const source = fs.readFileSync(
  path.join(apiRoot, 'src/fullstack-policy.ts'),
  'utf8'
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

const moduleContainer = { exports: {} };

new Function(
  'exports',
  'module',
  'require',
  compiled
)(
  moduleContainer.exports,
  moduleContainer,
  require
);

const {
  requiresFullStack,
  buildFullStackInstruction,
  validateFullStackArtifacts
} = moduleContainer.exports;

assert.strictEqual(
  requiresFullStack(
    'Create a beautiful portfolio website'
  ),
  false
);

assert.strictEqual(
  requiresFullStack(
    'Create an ecommerce website with backend, database and orders'
  ),
  true
);

assert.strictEqual(
  validateFullStackArtifacts(
    'Create a portfolio website',
    [{
      path: 'src/App.tsx',
      content: 'export default function App() {}'
    }]
  ).length,
  0
);

const incompleteIssues =
  validateFullStackArtifacts(
    'Create a website with login, backend, database and orders',
    [{
      path: 'src/App.tsx',
      content: 'export default function App() {}'
    }]
  );

assert.ok(
  incompleteIssues.length >= 4,
  'Frontend-only full-stack project was not rejected.'
);

const completeIssues =
  validateFullStackArtifacts(
    'Create a website with backend, database and orders',
    [
      {
        path: 'src/App.tsx',
        content:
          "export async function loadOrders(){ return fetch('/api/orders'); }"
      },
      {
        path: 'api/orders/route.ts',
        content:
          "app.get('/api/orders', async () => ({ orders: [] }));"
      },
      {
        path: 'supabase/migrations/001_orders.sql',
        content:
          'create table orders (id uuid primary key);'
      },
      {
        path: '.env.example',
        content:
          'DATABASE_URL=\nSUPABASE_URL=\n'
      },
      {
        path: 'README.md',
        content:
          '# Setup\nConfigure environment variables and run migrations.'
      }
    ]
  );

assert.deepStrictEqual(
  completeIssues,
  [],
  `Valid full-stack project failed: ${completeIssues.join(', ')}`
);

assert.ok(
  buildFullStackInstruction(
    'Build an admin dashboard with database'
  ).includes('FULL-STACK')
);

console.log(
  'SUCCESS: Full-stack generation policy tests passed.'
);
