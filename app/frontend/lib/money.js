// Prices are stored in paise (minor units). Indian formatting: ₹1,23,456
export function formatMoney(minor, currency = 'INR', locale = 'en-IN') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

// "349" or "349.50" → 34950. Done with string maths, so there are no floating-point rounding errors.
export function toMinor(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

// 34950 → "349.50", 34900 → "349"
export function fromMinor(minor) {
  const whole = Math.floor(minor / 100);
  const fraction = minor % 100;
  return fraction ? `${whole}.${String(fraction).padStart(2, '0')}` : String(whole);
}