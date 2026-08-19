/**
 * Due-urgency classification and color mapping.
 *
 * This is the canonical due-urgency bucketing for the LocateMVP system.
 * The same thresholds and colors are mirrored in the L720Ops portal
 * (L720Ops/src/utils/dueUrgency.ts) so that identical due timestamps
 * produce identical urgency colors on both mobile and web.
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
 * Classify a due timestamp into an urgency bucket.
 * Uses the same thresholds as the portal's dueUrgency.ts.
 */
export function getDueUrgencyBucket(dueAt?: number, nowMs: number = Date.now()): DueUrgencyBucket {
  if (!dueAt) return 'none';

  const diffHours = (dueAt - nowMs) / (1000 * 60 * 60);

  if (diffHours < 0) return 'overdue';
  if (diffHours < 2) return 'urgent';
  if (diffHours < 24) return 'today';
  if (diffHours < 72) return 'soon';
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
