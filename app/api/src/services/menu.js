export function publicMenuItem(i) {
  return {
    id: i._id,
    name: i.name,
    description: i.description,
    category: i.category,
    priceMinor: i.priceMinor,
    dietary: i.dietary,
    variants: i.variants,
    modifierGroups: i.modifierGroups,
    available: i.available,
  };
}

// Category order from settings first, then any other categories alphabetically; inside a category by sortOrder, then name
export function sortMenu(items, categories = []) {
  const rank = new Map(categories.map((c, i) => [c.toLowerCase(), i]));
  const position = (c) => rank.get((c ?? '').toLowerCase()) ?? Infinity;
  return [...items].sort(
    (a, b) =>
      position(a.category) - position(b.category) || // Infinity − Infinity is NaN, which falls through
      (a.category ?? '').localeCompare(b.category ?? '') ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.name.localeCompare(b.name)
  );
}