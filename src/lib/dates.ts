// This week's Monday in ISO 8601 (YYYY-MM-DD). `now` is injectable so the
// rule (Sunday → previous Monday, weekday → that week's Monday) is testable.
export function thisWeekMonday(now: Date = new Date()): string {
  const dayOfWeek = now.getDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday);
  return monday.toISOString().slice(0, 10);
}
