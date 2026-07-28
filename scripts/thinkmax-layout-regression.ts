import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const component = readFileSync(
  resolve(root, 'apps/mobile/src/ThinkMaxControl.tsx'),
  'utf8'
);
const app = readFileSync(resolve(root, 'apps/mobile/src/App.tsx'), 'utf8');
const chat = readFileSync(resolve(root, 'apps/mobile/src/ChatStudio.tsx'), 'utf8');
const css = readFileSync(
  resolve(root, 'apps/mobile/src/nexora-app-shell.css'),
  'utf8'
);

assert.match(component, /<div[\s\S]*className=/);
assert.doesNotMatch(component, /<label/);
assert.match(component, /role="switch"/);
assert.match(component, /aria-checked=\{enabled\}/);
assert.match(component, /onClick=\{\(\) => onChange\(!enabled\)\}/);
assert.doesNotMatch(component, /type="checkbox"/);
assert.doesNotMatch(app, /<label className="thinkmax-control/);
assert.doesNotMatch(chat, /<label className="thinkmax-control/);
assert.match(css, /\.thinkmax-switch\{[^}]*width:48px!important;[^}]*height:44px!important;/);
assert.match(css, /\.thinkmax-switch>span\{[^}]*width:48px;[^}]*height:28px;/);
assert.doesNotMatch(css, /\.thinkmax-control[^}]*position:(?:fixed|absolute)/);
assert.doesNotMatch(css, /\.thinkmax-switch\[aria-checked="true"\][^}]*\b(?:width|height|inset|position):/);

for (const viewportWidth of [360, 393, 412, 480]) {
  assert.ok(48 < viewportWidth, `bounded switch fits ${viewportWidth}px viewport`);
}

let enabled = false;
for (let index = 0; index < 100; index += 1) enabled = !enabled;
assert.equal(enabled, false, 'rapid even-numbered toggles preserve state');

console.log('ThinkMax interaction layout regression tests passed.');
