import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLine, choiceError, priceCart, setQty, unitPrice } from '../lib/cart.js';
import { formatMoney } from '../lib/money.js';

const pizza = {
  id: 'p1', name: 'Margherita', priceMinor: 34900, available: true,
  variants: [{ name: 'Regular', priceMinor: 34900 }, { name: 'Large', priceMinor: 49900 }],
  modifierGroups: [{ name: 'Add-ons', minSelect: 0, maxSelect: 3, options: [{ name: 'Extra cheese', priceDeltaMinor: 6000 }] }],
};
const paneer = {
  id: 'k1', name: 'Paneer Tikka', priceMinor: 29900, available: true, variants: [],
  modifierGroups: [{ name: 'Spice level', minSelect: 1, maxSelect: 1, options: [{ name: 'Mild', priceDeltaMinor: 0 }] }],
};
const cheese = [{ group: 'Add-ons', option: 'Extra cheese' }];

test('unit price matches the server: size plus add-ons', () => {
  assert.equal(unitPrice(pizza, 'Large', cheese), 55900);
  assert.equal(unitPrice(pizza, 'Huge', []), null);
});

test('required choices are enforced before adding to the cart', () => {
  assert.equal(choiceError(paneer, undefined, []), 'Choose a spice level');
  assert.equal(choiceError(paneer, undefined, [{ group: 'Spice level', option: 'Mild' }]), null);
  assert.equal(choiceError(pizza, undefined, []), 'Choose a size');
});

test('identical lines merge, and quantity 0 removes the line', () => {
  let cart = addLine([], { menuItemId: 'p1', variantName: 'Large', modifiers: cheese, qty: 1, notes: '' });
  cart = addLine(cart, { menuItemId: 'p1', variantName: 'Large', modifiers: cheese, qty: 1, notes: '' });
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 2);
  assert.equal(setQty(cart, cart[0].key, 0).length, 0);
});

test('cart total uses the latest menu and flags sold-out items', () => {
  const cart = addLine([], { menuItemId: 'p1', variantName: 'Large', modifiers: cheese, qty: 2, notes: '' });
  assert.equal(priceCart(cart, [pizza]).totalMinor, 111800);
  const soldOut = priceCart(cart, [{ ...pizza, available: false }]);
  assert.equal(soldOut.allOk, false);
  assert.equal(soldOut.totalMinor, 0);
});

test('money is formatted the Indian way', () => {
  const clean = (s) => s.replace(/\s/g, '');
  assert.equal(clean(formatMoney(34900)), '₹349');
  assert.equal(clean(formatMoney(12345600)), '₹1,23,456');
});