/**
 * Due-urgency classification and color mapping.
 *
 * This is the canonical due-urgency bucketing for the LocateMVP system.
 * The same thresholds and colors are mirrored in the L720Ops portal
 * (L720Ops/src/utils/dueUrgency.ts) so that identical due timestamps
 * produce identical urgency colors on both mobile and web.
 *
 * Buckets:
 *   overdue      — past due                          — #F87171 (light red)
 *   urgent       — emergency / no response (<2h)     — #D97706 (amber / dark orange)
 *   today        — due today                          — #FACC15 (yellow)
 *   tomorrow_am  — due tomorrow before 12pm           — #166534 (dark green / forest green)
 *   tomorrow_pm  — due tomorrow after 12pm            — #4ADE80 (light green)
 *   soon         — due after tomorrow (2 days out)    — #60A5FA (light blue)
 *   future       — due 2+ days out (3+ days)          — #1E40AF (dark blue)
 *   none         — no due date                        — #A7B0C2 (gray)
 *
 * Recalls and non-compliant tickets follow the same color coordination as normal tickets.
 */

export type DueUrgencyBucket = 'overdue' | 'urgent' | 'today' | 'tomorrow_am' | 'tomorrow_pm' | 'soon' | 'future' | 'none';

export const DUE_URGENCY_COLORS: Record<DueUrgencyBucket, string> = {
  overdue: '#F87171',
  urgent: '#D97706',
  today: '#FACC15',
  tomorrow_am: '#166534',
  tomorrow_pm: '#4ADE80',
  soon: '#60A5FA',
  future: '#1E40AF',
  none: '#A7B0C2',
};

export const DUE_URGENCY_LABELS: Record<DueUrgencyBucket, string> = {
  overdue: 'Late',
  urgent: 'Emergency',
  today: 'Today',
  tomorrow_am: 'Tomorrow AM',
  tomorrow_pm: 'Tomorrow PM',
  soon: '2 Days',
  future: '2+ Days',
  none: 'No Due Date',
};

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDaysLocal(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0);
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Classify a due timestamp into an urgency bucket.
 * Uses the same thresholds as the portal's dueUrgency.ts.
 */
export function getDueUrgencyBucket(dueAt?: number, nowMs: number = Date.now()): DueUrgencyBucket {
  if (!dueAt) return 'none';

  const now = new Date(nowMs);
  const due = new Date(dueAt);

  if (Number.isNaN(due.getTime())) return 'none';

  const diffMs = due.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  // Late / overdue
  if (diffHours < 0) return 'overdue';

  // Emergency / no response — within 2 hours
  if (diffHours < 2) return 'urgent';

  // Due today (same calendar day)
  if (isSameLocalDay(due, now)) return 'today';

  // Due tomorrow — split by AM/PM
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = addDaysLocal(todayStart, 1);
  const dayAfterTomorrowStart = addDaysLocal(todayStart, 2);

  if (due >= tomorrowStart && due < dayAfterTomorrowStart) {
    const hour = due.getHours();
    if (hour < 12) return 'tomorrow_am';
    return 'tomorrow_pm';
  }

  // Due after tomorrow (2 days out)
  const twoDaysStart = dayAfterTomorrowStart;
  const threeDaysStart = addDaysLocal(todayStart, 3);
  if (due >= twoDaysStart && due < threeDaysStart) return 'soon';

  // Due 2+ days out (3+ days)
  return 'future';
}

/**
 * Returns an accent color for a ticket card based on its due time.
 * Uses the canonical urgency bucketing.
 */
export function getDueAccentColorFromTimestamp(
  dueAt?: number,
  nowMs: number = Date.now(),
): string {
  return DUE_URGENCY_COLORS[getDueUrgencyBucket(dueAt, nowMs)];
}

/**
 * Check if a ticket is "late but rescheduled" — the original due date has
 * passed but the current due date is in the future. This is used for the
 * half-color indicator (top red, bottom new due color).
 */
export function isLateButRescheduled(
  dueAt?: number,
  originalDueAt?: number,
  nowMs: number = Date.now(),
): boolean {
  if (!dueAt || !originalDueAt) return false;
  if (originalDueAt === dueAt) return false;
  return originalDueAt < nowMs && dueAt > nowMs;
}

/**
 * Returns the two colors for a half-color indicator when a ticket is
 * late but rescheduled. Top color = red (overdue), bottom color = the
 * new due date's urgency color.
 */
export function getRescheduledHalfColors(
  dueAt?: number,
  originalDueAt?: number,
  nowMs: number = Date.now(),
): { topColor: string; bottomColor: string } | null {
  if (!isLateButRescheduled(dueAt, originalDueAt, nowMs)) return null;
  return {
    topColor: DUE_URGENCY_COLORS.overdue,
    bottomColor: getDueAccentColorFromTimestamp(dueAt, nowMs),
  };
}
