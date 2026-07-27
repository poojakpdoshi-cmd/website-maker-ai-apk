import assert from 'node:assert/strict';
import { formatElapsedDuration } from '../apps/mobile/src/duration-format';

assert.equal(formatElapsedDuration(null), null);
assert.equal(formatElapsedDuration(undefined), null);
assert.equal(formatElapsedDuration(Number.NaN), null);
assert.equal(formatElapsedDuration(-1), null);
assert.equal(formatElapsedDuration(482), '482ms');
assert.equal(formatElapsedDuration(1400), '1.4s');
assert.equal(formatElapsedDuration(59_949), '59.9s');
assert.equal(formatElapsedDuration(60_000), '1m 0s');
assert.equal(formatElapsedDuration(138_000), '2m 18s');

console.log('Duration formatting regression checks passed.');
