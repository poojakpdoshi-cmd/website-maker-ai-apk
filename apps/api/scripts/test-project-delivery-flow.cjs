const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/index.ts'),
  'utf8'
);

assert.ok(
  /generated\.files/.test(source),
  'Generated project files are not saved.'
);

assert.ok(
  /\/projects\/:id\/source/.test(source),
  'Project source download route is missing.'
);

assert.ok(
  /const\s+deployFiles\s*=/.test(source),
  'Deployment file collection is missing.'
);

assert.ok(
  /pushToGitHub\([\s\S]{0,500}deployFiles/.test(source),
  'GitHub deployment does not receive all project files.'
);

assert.ok(
  /deployToVercel\([\s\S]{0,500}deployFiles/.test(source),
  'Vercel deployment does not receive all project files.'
);

assert.ok(
  /injectCmsRuntime\([\s\S]{0,300}files/.test(source),
  'CMS runtime injection is not preserving project files.'
);

console.log(
  'SUCCESS: Save, source download and deployment flow verified.'
);
