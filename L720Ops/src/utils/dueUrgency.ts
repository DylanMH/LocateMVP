/**
 * Due-urgency classification and color mapping for the L720Ops portal.
 *
 * This mirrors the mobile app's dueColor.ts (Locate720/src/features/tickets/domain/dueColor.ts)
 * so that identical due timestamps produce identical urgency colors on both
 * mobile and web. The thresholds and colors must stay in sync.
 *
 * Buckets:
 *   overdue  — past due                — #E5484D (red)
 *   urgent   — within 2 hours          — #FF6F00 (deep orange)
 *   today    — within 24 hours         — #FFA726 (orange)
 *   soon     — within 72 hours         — #3498DB (blue)
 *   future   — more than 72 hours      — #0B5CAD (dark blue)
 *   none     — no due date             — #A7B0C2 (gray)
 */

export type DueUrgencyBucket = 'overdue' | 'urgent' | 'today' | 'soon' | 'future' | 'none';

export const DUE_URGENCY_COLORS: Record<DueUrgencyBucket, string> = {
  overdue: '#E5484D',
  urgent: '#FF6F00',
  today: '#FFA726',
  soon: '#3498DB',
  future: '#0B5CAD',
  none: '#A7B0C2',
};

export const DUE_URGENCY_LABELS: Record<DueUrgencyBucket, string> = {
  overdue: 'Overdue',
  urgent: 'Urgent',
  today: 'Today',
  soon: 'Soon',
  future: 'Future',
  none: 'No Due Date',
};

/**
 * Tailwind CSS classes for each urgency bucket (for badges/pills).
 */
export const DUE_URGENCY_TAILWIND: Record<DueUrgencyBucket, string> = {
  overdue: 'bg-red-100 text-red-700 border-red-300',
  urgent: 'bg-orange-100 text-orange-700 border-orange-300',
  today: 'bg-amber-100 text-amber-700 border-amber-300',
  soon: 'bg-blue-100 text-blue-700 border-blue-300',
  future: 'bg-blue-50 text-blue-600 border-blue-200',
  none: 'bg-gray-100 text-gray-500 border-gray-200',
};

/**
 * Classify a due timestamp into an urgency bucket.
 * Uses the same thresholds as the mobile app's dueColor.ts.
 */
export function getDueUrgencyBucket(dueAt?: number | null, nowMs: number = Date.now()): DueUrgencyBucket {
  if (!dueAt) return 'none';

  const diffHours = (dueAt - nowMs) / (1000 * 60 * 60);

  if (diffHours < 0) return 'overdue';
  if (diffHours < 2) return 'urgent';
  if (diffHours < 24) return 'today';
  if (diffHours < 72) return 'soon';
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
