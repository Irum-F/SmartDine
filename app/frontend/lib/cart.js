// Price of one unit with the chosen size and add-ons. null = the choice no longer exists.
export function unitPrice(item, variantName, modifiers = []) {
  let base = item.priceMinor;
  if (item.variants?.length) {
    const variant = item.variants.find((v) => v.name === variantName);
    if (!variant) return null;
    base = variant.priceMinor;
  }
  let extra = 0;
  for (const m of modifiers) {
    const group = item.modifierGroups?.find((g) => g.name === m.group);
    const option = group?.options.find((o) => o.name === m.option);
    if (!option) return null;
    extra += option.priceDeltaMinor;
  }
  return base + extra;
}

// The same rules the server enforces, so the guest sees the problem before tapping "Add"
export function choiceError(item, variantName, modifiers = []) {
  if (item.variants?.length && !item.variants.some((v) => v.name === variantName)) return 'Choose a size';
  for (const g of item.modifierGroups ?? []) {
    const count = modifiers.filter((m) => m.group === g.name).length;
    if (count < g.minSelect) return g.minSelect === 1 ? `Choose a ${g.name.toLowerCase()}` : `Choose at least ${g.minSelect}: ${g.name}`;
    if (count > g.maxSelect) return `Choose up to ${g.maxSelect}: ${g.name}`;
  }
  return null;
}

// Identical choices merge into one line instead of appearing twice
export function lineKey({ menuItemId, variantName = '', modifiers = [], notes = '' }) {
  const mods = modifiers.map((m) => `${m.group}:${m.option}`).sort().join('|');
  return [menuItemId, variantName ?? '', mods, notes.trim()].join('#');
}

export function addLine(cart, line) {
  const key = lineKey(line);
  if (cart.some((l) => l.key === key)) {
    return cart.map((l) => (l.key === key ? { ...l, qty: Math.min(l.qty + line.qty, 50) } : l));
  }
  return [...cart, { ...line, key }];
}

export function setQty(cart, key, qty) {
  if (qty <= 0) return cart.filter((l) => l.key !== key);
  return cart.map((l) => (l.key === key ? { ...l, qty: Math.min(qty, 50) } : l));
}

// Prices always come from the latest menu, never from what was saved in the cart
export function priceCart(cart, menu) {
  const byId = new Map(menu.map((i) => [i.id, i]));
  let totalMinor = 0;
  const lines = cart.map((l) => {
    const item = byId.get(l.menuItemId);
    const unit = item ? unitPrice(item, l.variantName, l.modifiers) : null;
    const ok = Boolean(item?.available) && unit !== null;
    if (ok) totalMinor += unit * l.qty;
    return { ...l, name: item?.name ?? 'Removed item', unitPriceMinor: unit, ok };
  });
  return { lines, totalMinor, allOk: lines.every((l) => l.ok) };
}