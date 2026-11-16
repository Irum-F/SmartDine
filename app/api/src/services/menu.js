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