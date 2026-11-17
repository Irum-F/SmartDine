import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMinor, toMinor } from '../lib/money.js';

test('typed prices become exact paise', () => {
  assert.equal(toMinor('349'), 34900);
  assert.equal(toMinor('349.5'), 34950);
  assert.equal(toMinor(' 0.10 '), 10);
  assert.equal(toMinor('19.99'), 1999); // 19.99 * 100 is 1998.9999… in floating point
});

test('anything that is not a price is refused', () => {
  for (const bad of ['', 'abc', '-5', '1.234', '1,000', '100000']) assert.equal(toMinor(bad), null);
});

test('paise show as a typed price again', () => {
  assert.equal(fromMinor(34900), '349');
  assert.equal(fromMinor(34950), '349.50');
  assert.equal(fromMinor(5), '0.05');
});