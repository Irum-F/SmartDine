const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function isOpenNow(restaurant, now = new Date()) {
  const hours = restaurant.openingHours ?? [];
  if (hours.length === 0) return true;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: restaurant.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type)?.value;

  const day = DAYS.indexOf(part('weekday'));
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  const previousDay = (day + 6) % 7;

  return hours.some((h) => {
    const open = toMinutes(h.open);
    const close = toMinutes(h.close);
    if (close > open) return h.day === day && minutes >= open && minutes < close;
    // Overnight: open late on h.day, closing early the next morning
    return (h.day === day && minutes >= open) || (h.day === previousDay && minutes < close);
  });
}