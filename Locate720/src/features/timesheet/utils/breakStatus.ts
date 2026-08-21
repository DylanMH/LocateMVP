/**
 * Shared utility for checking break status (lunch/personal time)
 * Used by both timesheet and tickets screens
 */

import { Q } from '@nozbe/watermelondb';
import { database } from '../../../db/database';
import ClockEvent from '../../../db/models/ClockEvent';
import DaySession from '../../../db/models/DaySession';
import type { BreakStatus } from '../types';
import { logger } from '../../../utils/logger';

/**
 * Check if user is currently on lunch or personal break
 * Returns break status with type and start time if on break
 */
export async function checkUserBreakStatus(
  userId: string,
  today: string
): Promise<BreakStatus> {
  try {
    const sessionsCollection = database.collections.get<DaySession>('day_sessions');
    
    const sessions = await sessionsCollection
      .query(
        Q.where('user_id', userId),
        Q.where('date', today),
        Q.sortBy('created_at', Q.desc)
      )
      .fetch();
    
    if (sessions.length === 0 || sessions[0].status !== 'ACTIVE') {
      return { isOnBreak: false, breakType: null, startedAt: null };
    }
    
    const mostRecent = sessions[0];
    const eventsCollection = database.collections.get<ClockEvent>('clock_events');
    
    // Fetch ALL break events for this session in one query
    const breakEvents = await eventsCollection
      .query(
        Q.where('session_id', mostRecent.id),
        Q.or(
          Q.where('event_type', 'LUNCH_START'),
          Q.where('event_type', 'LUNCH_END'),
          Q.where('event_type', 'PERSONAL_START'),
          Q.where('event_type', 'PERSONAL_END')
        ),
        Q.sortBy('occurred_at', Q.desc)
      )
      .fetch();
    
    let latestLunchStartAt: number | null = null;
    let latestLunchEndAt: number | null = null;
    let latestPersonalStartAt: number | null = null;
    let latestPersonalEndAt: number | null = null;
    
    for (const event of breakEvents) {
      if (event.eventType === 'LUNCH_START') {
        if (!latestLunchStartAt || event.occurredAt > latestLunchStartAt) {
          latestLunchStartAt = event.occurredAt;
        }
      } else if (event.eventType === 'LUNCH_END') {
        if (!latestLunchEndAt || event.occurredAt > latestLunchEndAt) {
          latestLunchEndAt = event.occurredAt;
        }
      } else if (event.eventType === 'PERSONAL_START') {
        if (!latestPersonalStartAt || event.occurredAt > latestPersonalStartAt) {
          latestPersonalStartAt = event.occurredAt;
        }
      } else if (event.eventType === 'PERSONAL_END') {
        if (!latestPersonalEndAt || event.occurredAt > latestPersonalEndAt) {
          latestPersonalEndAt = event.occurredAt;
        }
      }
    }

    const isPersonalActive =
      latestPersonalStartAt !== null &&
      (latestPersonalEndAt === null || latestPersonalStartAt > latestPersonalEndAt);
    const isLunchActive =
      latestLunchStartAt !== null &&
      (latestLunchEndAt === null || latestLunchStartAt > latestLunchEndAt);
    
    // Return the most recent active break if both somehow appear active.
    if (isPersonalActive && (!isLunchActive || latestPersonalStartAt! >= latestLunchStartAt!)) {
      return {
        isOnBreak: true,
        breakType: 'personal',
        startedAt: latestPersonalStartAt,
      };
    }
    
    if (isLunchActive) {
      return {
        isOnBreak: true,
        breakType: 'lunch',
        startedAt: latestLunchStartAt,
      };
    }
    
    return { isOnBreak: false, breakType: null, startedAt: null };
  } catch (error) {
    logger.error('[BreakStatus] Error checking break status:', error);
    return { isOnBreak: false, breakType: null, startedAt: null };
  }
}

/**
 * Get today's date in YYYY-MM-DD format (local timezone).
 *
 * Uses toLocaleDateString with en-CA locale which produces YYYY-MM-DD.
 * This avoids the UTC rollover bug where new Date().toISOString().split('T')[0]
 * returns the UTC calendar date, which can differ from the local calendar
 * date near local midnight (e.g. 11pm CST = 5am UTC next day).
 */
export function getTodayDateString(): string {
  return new Date().toLocaleDateString('en-CA');
}

/**
 * Get start of today in milliseconds (00:00:00.000)
 */
export function getTodayStartTimestamp(): number {
  return new Date().setHours(0, 0, 0, 0);
}

/**
 * Get start of the next local day in milliseconds (tomorrow 00:00:00.000).
 * Used for the closed-ticket daily boundary:
 *   startOfLocalDay <= closedAt < startOfNextLocalDay
 */
export function getStartOfNextLocalDay(): number {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.setHours(0, 0, 0, 0);
}
