/**
 * Ticket Time Calculation Utilities
 * 
 * Single source of truth for all time-based calculations on tickets.
 * Derives durations from timeline events stored in ticket.payload_json.
 * 
 * Timeline fields in payload:
 * - enrouteStartedAt?: number
 * - enrouteEndedAt?: number
 * - onsiteStartedAt?: number
 * - onsiteEndedAt?: number
 * - pauseEvents?: Array<{ start: number; end?: number }>
 * - closedAt?: number
 */

export { formatDuration } from '../../../utils/formatDuration';

export interface PauseEvent {
  start: number;
  end?: number;
}

export interface TicketPayload {
  enrouteStartedAt?: number;
  enrouteEndedAt?: number;
  onsiteStartedAt?: number;
  onsiteEndedAt?: number;
  pauseEvents?: PauseEvent[];
  closedAt?: number;
  [key: string]: any;
}

/**
 * Get the effective end time for duration calculations.
 * Priority: closedAt > onsiteEndedAt (if closed) > pauseStart (if paused) > Date.now()
 */
export function getEffectiveEndTime(payload: TicketPayload, locatorStatus: string): number {
  if (payload.closedAt) {
    return payload.closedAt;
  }
  
  // Safety: If ticket is CLOSED/UNABLE but missing closedAt, use onsiteEndedAt or onsiteStartedAt as fallback
  if (locatorStatus === 'CLOSED' || locatorStatus === 'UNABLE') {
    // Prefer onsiteEndedAt if available
    if (payload.onsiteEndedAt) {
      return payload.onsiteEndedAt;
    }
    // Fallback to onsiteStartedAt (will show 0 allocatable time, better than continuing to count)
    if (payload.onsiteStartedAt) {
      return payload.onsiteStartedAt;
    }
  }
  
  if (locatorStatus === 'PAUSED' && payload.pauseEvents && payload.pauseEvents.length > 0) {
    const lastPause = payload.pauseEvents[payload.pauseEvents.length - 1];
    if (!lastPause.end) {
      return lastPause.start;
    }
  }
  
  return Date.now();
}

/**
 * Calculate total paused milliseconds.
 * For open pause events, use Date.now() as end time for calculation.
 */
export function getPausedMillis(payload: TicketPayload): number {
  if (!payload.pauseEvents || payload.pauseEvents.length === 0) {
    return 0;
  }
  
  return payload.pauseEvents.reduce((total, pause) => {
    const end = pause.end ?? Date.now();
    return total + (end - pause.start);
  }, 0);
}

/**
 * Calculate total paused milliseconds that occurred within the onsite window.
 * This is used to subtract pauses from onsite duration.
 * @param payload - Ticket payload with timeline data
 * @param effectiveEndTime - The effective end time (from getEffectiveEndTime) to use for open pauses
 */
export function getPausedMillisWithinOnsite(payload: TicketPayload, effectiveEndTime: number): number {
  if (!payload.onsiteStartedAt || !payload.pauseEvents || payload.pauseEvents.length === 0) {
    return 0;
  }
  
  const onsiteStart = payload.onsiteStartedAt;
  const onsiteEnd = payload.onsiteEndedAt ?? effectiveEndTime;
  
  return payload.pauseEvents.reduce((total, pause) => {
    // Only count pauses that occurred within onsite window
    if (pause.start >= onsiteStart && pause.start <= onsiteEnd) {
      // Use effective end time instead of Date.now() for open pause events
      const end = pause.end ?? effectiveEndTime;
      const pauseDuration = Math.min(end, onsiteEnd) - pause.start;
      return total + Math.max(0, pauseDuration);
    }
    return total;
  }, 0);
}

/**
 * Calculate total onsite milliseconds (excluding paused time).
 * Returns 0 if not yet onsite.
 */
export function getOnsiteMillis(payload: TicketPayload, locatorStatus: string): number {
  if (!payload.onsiteStartedAt) {
    return 0;
  }
  
  const endTime = getEffectiveEndTime(payload, locatorStatus);
  const rawDuration = endTime - payload.onsiteStartedAt;
  const pausedWithinOnsite = getPausedMillisWithinOnsite(payload, endTime);
  
  // Onsite duration minus paused time, clamped to 0
  return Math.max(0, rawDuration - pausedWithinOnsite);
}

/**
 * Calculate total enroute milliseconds.
 * Returns 0 if never enroute.
 */
export function getEnrouteMillis(payload: TicketPayload, locatorStatus: string): number {
  if (!payload.enrouteStartedAt) {
    return 0;
  }
  
  const endTime = payload.enrouteEndedAt ?? getEffectiveEndTime(payload, locatorStatus);
  return Math.max(0, endTime - payload.enrouteStartedAt);
}

/**
 * Get allocatable minutes from onsite time.
 * This is the time that must be distributed to customers.
 */
export function getAllocatableMinutes(payload: TicketPayload, locatorStatus: string): number {
  const onsiteMillis = getOnsiteMillis(payload, locatorStatus);
  return Math.floor(onsiteMillis / 60000);
}
