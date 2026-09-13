import test from 'node:test';
import assert from 'node:assert/strict';
import { InventoryStore } from '../src/store.js';

test('concurrent reservations cannot oversell limited stock', async () => {
  const store = new InventoryStore();
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => store.reserve([{ productId: 'linen-apron', quantity: 1 }], `attempt-${index}`)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 5);
  assert.equal((await store.getProduct('linen-apron')).stock, 0);
});

test('failed payment restores reserved stock', async () => {
  const store = new InventoryStore();
  const order = await store.reserve([{ productId: 'coffee-beans', quantity: 2 }], 'failure-case');
  await store.pay(order.id, 'failure');
  assert.equal((await store.getProduct('coffee-beans')).stock, 8);
});

test('expired reservations release stock and become expired', async () => {
  const store = new InventoryStore();
  const order = await store.reserve([{ productId: 'linen-apron', quantity: 1 }], 'expiry-case');
  order.expiresAt = Date.now() - 1;
  await store.expireReservations();
  assert.equal(order.status, 'expired');
  assert.equal((await store.getProduct('linen-apron')).stock, 5);
});

test('cancelling a paid order restores stock', async () => {
  const store = new InventoryStore();
  const order = await store.reserve([{ productId: 'ceramic-mug', quantity: 2 }], 'paid-cancel-case');
  await store.pay(order.id, 'success');
  await store.cancel(order.id);
  assert.equal(order.status, 'cancelled');
  assert.equal((await store.getProduct('ceramic-mug')).stock, 12);
});
