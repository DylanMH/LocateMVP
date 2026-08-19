/**
 * Due-urgency classification and color mapping for the L720Ops portal.
 *
 * This mirrors the mobile app's dueColor.ts (Locate720/src/features/tickets/domain/dueColor.ts)
 * so that identical due timestamps produce identical urgency colors on both
 * mobile and web. The thresholds and colors must stay in sync.
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

/**
 * Tailwind CSS classes for each urgency bucket (for badges/pills).
 */
export const DUE_URGENCY_TAILWIND: Record<DueUrgencyBucket, string> = {
  overdue: 'bg-red-100 text-red-700 border-red-300',
  urgent: 'bg-amber-100 text-amber-700 border-amber-300',
  today: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  tomorrow_am: 'bg-green-100 text-green-700 border-green-300',
  tomorrow_pm: 'bg-green-50 text-green-600 border-green-200',
  soon: 'bg-blue-100 text-blue-700 border-blue-300',
  future: 'bg-blue-50 text-blue-600 border-blue-200',
  none: 'bg-gray-100 text-gray-500 border-gray-200',
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
 * Uses the same thresholds as the mobile app's dueColor.ts.
 */
export function getDueUrgencyBucket(dueAt?: number | null, nowMs: number = Date.now()): DueUrgencyBucket {
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
 * Get the hex color for a due timestamp's urgency bucket.
 */
export function getDueUrgencyColor(dueAt?: number | null, nowMs: number = Date.now()): string {
  return DUE_URGENCY_COLORS[getDueUrgencyBucket(dueAt, nowMs)];
}

/**
 * Get the Tailwind classes for a due timestamp's urgency bucket.
 */
export function getDueUrgencyTailwind(dueAt?: number | null, nowMs: number = Date.now()): string {
  return DUE_URGENCY_TAILWIND[getDueUrgencyBucket(dueAt, nowMs)];
}
