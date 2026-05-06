// This week's Monday in ISO 8601 (YYYY-MM-DD).
export function thisWeekMonday(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysFromMonday);
  return monday.toISOString().slice(0, 10);
}
