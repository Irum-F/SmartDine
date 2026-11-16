import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageClass, applyUpdate, canCancel, mergeSnapshot, nextAction } from '../lib/kitchen.js';

test('buttons follow the same rules as the API', () => {
  assert.equal(nextAction('kitchen', 'placed').to, 'cooking');
  assert.equal(nextAction('kitchen', 'cooking').to, 'ready');
  assert.equal(nextAction('kitchen', 'ready'), null); // serving is a floor job
  assert.equal(nextAction('waiter', 'placed'), null);
  assert.equal(nextAction('waiter', 'ready').to, 'served');
  assert.equal(canCancel('manager', 'cooking'), true);
  assert.equal(canCancel('kitchen', 'placed'), false);
});

test('tickets turn amber at 15 minutes and red at 25', () => {
  assert.equal(ageClass(14), '');
  assert.equal(ageClass(15), 'warn');
  assert.equal(ageClass(25), 'late');
});

test('served and cancelled orders leave the screen; stale updates are ignored', () => {
  const start = new Map([['a', { id: 'a', status: 'cooking', updatedAt: '2026-11-15T10:00:05Z' }]]);
  const stale = applyUpdate(start, { id: 'a', status: 'placed', updatedAt: '2026-11-15T10:00:01Z' });
  assert.equal(stale.get('a').status, 'cooking');
  const served = applyUpdate(start, { id: 'a', status: 'served', updatedAt: '2026-11-15T10:00:09Z' });
  assert.equal(served.has('a'), false);
});

test('a fresh snapshot keeps updates that arrived after it was taken', () => {
  const prev = new Map([
    ['new', { id: 'new', status: 'placed', updatedAt: '2026-11-15T10:00:05Z' }],
    ['gone', { id: 'gone', status: 'ready', updatedAt: '2026-11-15T09:50:00Z' }],
  ]);
  const next = mergeSnapshot(prev, [], '2026-11-15T10:00:03Z');
  assert.equal(next.has('new'), true); // arrived after the snapshot: kept
  assert.equal(next.has('gone'), false); // older than the snapshot and not in it: finished elsewhere
});