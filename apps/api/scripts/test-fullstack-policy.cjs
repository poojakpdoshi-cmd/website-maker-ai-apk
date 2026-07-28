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


const exposedSecretIssues =
  validateFullStackArtifacts(
    'Create an admin website with backend and database',
    [
      {
        path: 'src/config.ts',
        content:
          "export const key = 'SUPABASE_SERVICE_ROLE_KEY=super-secret-value';"
      },
      {
        path: 'api/admin.ts',
        content:
          "app.get('/api/admin', () => ({}));"
      },
      {
        path: 'migrations/001.sql',
        content:
          'create table admins (id uuid primary key);'
      },
      {
        path: '.env.example',
        content:
          'SUPABASE_SERVICE_ROLE_KEY=\n'
      },
      {
        path: 'README.md',
        content:
          '# Setup'
      }
    ]
  );

assert.ok(
  exposedSecretIssues.some(
    (issue) =>
      issue.includes('secrets are exposed')
  ),
  'Frontend secret exposure was not detected.'
);

const unsafeEnvIssues =
  validateFullStackArtifacts(
    'Create an ecommerce backend with database',
    [
      {
        path: 'src/App.tsx',
        content:
          "fetch('/api/orders');"
      },
      {
        path: 'api/orders.ts',
        content:
          "app.get('/api/orders', () => []);"
      },
      {
        path: 'migrations/001.sql',
        content:
          'create table orders (id uuid primary key);'
      },
      {
        path: '.env.example',
        content:
          'DATABASE_URL=postgres://real-secret-value\n'
      },
      {
        path: 'README.md',
        content:
          '# Setup'
      }
    ]
  );

assert.ok(
  unsafeEnvIssues.some(
    (issue) =>
      issue.includes('.env.example')
  ),
  'Unsafe .env.example value was not detected.'
);

const duplicateIssues =
  validateFullStackArtifacts(
    'Create a website with backend and database',
    [
      {
        path: 'src/App.tsx',
        content:
          "fetch('/api/data');"
      },
      {
        path: 'api/data.ts',
        content:
          "app.get('/api/data', () => []);"
      },
      {
        path: 'API/data.ts',
        content:
          "app.get('/api/data', () => []);"
      },
      {
        path: 'migrations/001.sql',
        content:
          'create table data (id uuid primary key);'
      },
      {
        path: '.env.example',
        content:
          'DATABASE_URL=\n'
      },
      {
        path: 'README.md',
        content:
          '# Setup'
      }
    ]
  );

assert.ok(
  duplicateIssues.some(
    (issue) =>
      issue.includes('duplicate file paths')
  ),
  'Duplicate generated paths were not detected.'
);

console.log(
  'SUCCESS: Full-stack generation policy tests passed.'
);
