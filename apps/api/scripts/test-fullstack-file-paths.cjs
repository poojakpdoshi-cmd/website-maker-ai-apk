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
  path.join(apiRoot, 'src/council-project.ts'),
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

const { parseCouncilProjectPatch } =
  moduleContainer.exports;

const result = parseCouncilProjectPatch(
  JSON.stringify({
    files: [
      {
        path: 'api/orders.ts',
        content:
          "export async function GET(){ return Response.json([]); }"
      },
      {
        path: 'supabase/migrations/001_orders.sql',
        content:
          'create table orders (id uuid primary key);'
      },
      {
        path: '.env.example',
        content:
          'SUPABASE_URL=\nSUPABASE_ANON_KEY=\n'
      },
      {
        path: 'README.md',
        content:
          '# Setup'
      },
      {
        path: '../secret.ts',
        content:
          'unsafe'
      },
      {
        path: 'api/../../secret.ts',
        content:
          'unsafe'
      }
    ],
    summary:
      'Full-stack project files generated.'
  })
);

const paths = result.files.map(
  (file) => file.path
);

assert.ok(paths.includes('api/orders.ts'));
assert.ok(
  paths.includes(
    'supabase/migrations/001_orders.sql'
  )
);
assert.ok(paths.includes('.env.example'));
assert.ok(paths.includes('README.md'));

assert.ok(!paths.includes('../secret.ts'));
assert.ok(
  !paths.includes('api/../../secret.ts')
);

console.log(
  'SUCCESS: Full-stack file whitelist tests passed.'
);
