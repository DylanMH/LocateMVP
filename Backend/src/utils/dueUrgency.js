/**
 * Canonical due urgency computation.
 * 5 categories: OVERDUE, DUE_WITHIN_2_HOURS, DUE_TODAY, DUE_WITHIN_72_HOURS, FUTURE
 */

export const DUE_URGENCY = {
  OVERDUE: 'OVERDUE',
  DUE_WITHIN_2_HOURS: 'DUE_WITHIN_2_HOURS',
  DUE_TODAY: 'DUE_TODAY',
  DUE_WITHIN_72_HOURS: 'DUE_WITHIN_72_HOURS',
  FUTURE: 'FUTURE',
};

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

/**
 * Compute due urgency for a ticket.
 * @param {number|null|undefined} dueAt - due timestamp in ms since epoch
 * @param {number} now - current timestamp in ms (default Date.now())
 * @returns {string} one of DUE_URGENCY values, or null if dueAt is null/invalid
 */
export function computeDueUrgency(dueAt, now = Date.now()) {
  if (dueAt == null || typeof dueAt !== 'number' || Number.isNaN(dueAt)) {
    return null;
  }
  if (dueAt <= now) return DUE_URGENCY.OVERDUE;
  if (dueAt <= now + TWO_HOURS_MS) return DUE_URGENCY.DUE_WITHIN_2_HOURS;
  // "Today" = due before end of current calendar day (local server time)
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (dueAt <= endOfToday.getTime()) return DUE_URGENCY.DUE_TODAY;
  if (dueAt <= now + SEVENTY_TWO_HOURS_MS) return DUE_URGENCY.DUE_WITHIN_72_HOURS;
  return DUE_URGENCY.FUTURE;
}
