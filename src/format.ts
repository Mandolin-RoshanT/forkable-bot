// Pure formatting helpers: display labels for the CLI, this week's Monday,
// and PII masking. No I/O, no side effects — each function takes a value
// and returns a string ready for console.log().

import type { Bucket } from './models.ts';
import type { Delivery } from './schemas/forkable.ts';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function dayLabel(day: Delivery): string {
  const d = new Date(day.forDeliveryAt);
  return `${DAYS_OF_WEEK[d.getUTCDay()]} ${day.forDeliveryAt.slice(0, 10)}`;
}

export function bucketLabel(b: Bucket): string {
  switch (b) {
    case 'green':
      return '[GREEN] ';
    case 'yellow':
      return '[YELLOW]';
    case 'red':
      return '[RED]   ';
  }
}

export function formatPrice(n: number | null): string {
  if (n === null) return '   --   ';
  return `$${n.toFixed(2).padStart(6)}`;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

// This week's Monday in ISO 8601 (YYYY-MM-DD). `now` is injectable so the
// rule (Sunday → previous Monday, weekday → that week's Monday) is testable.
export function thisWeekMonday(now: Date = new Date()): string {
  const dayOfWeek = now.getDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday);
  return monday.toISOString().slice(0, 10);
}

export function redactCookie(value: string): string {
  return `<${value.length} chars, prefix: ${value.slice(0, 4)}>`;
}

export function redactEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) {
    return '<invalid email>';
  }
  return `${user[0]}***@${domain}`;
}
