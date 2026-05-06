// Pure formatting helpers for the CLI commands. No I/O, no side effects —
// each function takes a value and returns a string ready for console.log().

import type { Bucket } from '../models.ts';
import type { Delivery } from '../schemas/forkable.ts';

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
