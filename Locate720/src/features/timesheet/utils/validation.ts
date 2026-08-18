/**
 * Shared validation utilities for timesheet operations
 * Prevents code duplication between clock out, lunch, and personal time
 */

import { Q } from '@nozbe/watermelondb';
import { database } from '../../../db/database';
import Ticket from '../../../db/models/Ticket';
import DaySession from '../../../db/models/DaySession';
import ClockEvent from '../../../db/models/ClockEvent';
import { checkUserBreakStatus } from './breakStatus';
import { createClockEvent } from '../../tickets/domain/outbox';
import { SyncEngine } from '../../tickets/sync/SyncEngine';
import { API_BASE_URL, ENDPOINTS } from '../../../config/api';
import { logger } from '../../../utils/logger';

export interface ActiveTicketsCheck {
  hasActiveTickets: boolean;
  count: number;
  tickets: Ticket[];
}

export interface CloseActiveSessionOptions {
  userId: string;
  ticketId?: string;
  endActiveBreak?: boolean;
  requireNoActiveTickets?: boolean;
}

export interface CloseActiveSessionResult {
  closed: boolean;
  session: DaySession | null;
  endedBreakType: 'lunch' | 'personal' | null;
}

/**
 * Check if user has any active tickets (ENROUTE or ONSITE)
 * Used to prevent clock out, lunch, or personal time when actively working tickets
 * 
 * Performance: Indexed query on assigned_tech_id and locator_status
 * Scalability: O(1) with proper indexes, regardless of total ticket count
 */
export async function checkActiveTickets(userId: string): Promise<ActiveTicketsCheck> {
  try {
    const ticketsCollection = database.collections.get<Ticket>('tickets');
    const activeTickets = await ticketsCollection
      .query(
        Q.where('assigned_tech_id', userId),
        Q.or(
          Q.where('locator_status', 'ENROUTE'),
          Q.where('locator_status', 'ONSITE')
        )
      )
      .fetch();
    
    return {
      hasActiveTickets: activeTickets.length > 0,
      count: activeTickets.length,
      tickets: activeTickets,
    };
  } catch (error) {
    console.error('[Validation] Error checking active tickets:', error);
    return {
      hasActiveTickets: false,
      count: 0,
      tickets: [],
    };
  }
}

/**
 * Get validation error message for active tickets
 */
export function getActiveTicketsErrorMessage(
  count: number,
  action: 'clock out' | 'start lunch' | 'start personal time'
): { title: string; message: string } {
  const actionTitle = action === 'clock out' ? 'Clock Out' : 
                      action === 'start lunch' ? 'Start Lunch' : 
                      'Start Personal Time';
  
  const actionVerb = action === 'clock out' ? 'clocking out' :
                     action === 'start lunch' ? 'taking lunch' :
                     'taking personal time';
  
  return {
    title: `Cannot ${actionTitle}`,
    message: `You have ${count} active ticket(s) in ENROUTE or ONSITE status. Please pause or close these tickets before ${actionVerb}.`,
  };
}

export async function getLatestTodaySession(userId: string): Promise<DaySession | null> {
  const today = new Date().toISOString().split('T')[0];
  const sessionsCollection = database.collections.get<DaySession>('day_sessions');
  const sessions = await sessionsCollection
    .query(
      Q.where('user_id', userId),
      Q.where('date', today),
      Q.sortBy('created_at', Q.desc),
    )
    .fetch();

  return sessions[0] || null;
}

export async function closeActiveSession(
  options: CloseActiveSessionOptions,
): Promise<CloseActiveSessionResult> {
  const {
    userId,
    ticketId,
    endActiveBreak = false,
    requireNoActiveTickets = true,
  } = options;

  if (requireNoActiveTickets) {
    const activeCheck = await checkActiveTickets(userId);
    if (activeCheck.hasActiveTickets) {
      const errorMsg = getActiveTicketsErrorMessage(activeCheck.count, 'clock out');
      throw new Error(errorMsg.message);
    }
  }

  const activeSession = await getLatestTodaySession(userId);
  if (!activeSession || activeSession.status !== 'ACTIVE') {
    return { closed: false, session: null, endedBreakType: null };
  }

  const eventsCollection = database.collections.get<ClockEvent>('clock_events');
  const now = Date.now();
  const queuedEvents: ReturnType<typeof createClockEvent>[] = [];
  let endedBreakType: 'lunch' | 'personal' | null = null;

  if (endActiveBreak) {
    const breakStatus = await checkUserBreakStatus(userId, activeSession.date);
    if (breakStatus.isOnBreak) {
      endedBreakType = breakStatus.breakType;
    }
  }

  await database.write(async () => {
    if (endedBreakType) {
      await eventsCollection.create((event) => {
        event.sessionId = activeSession.id;
        event.userId = userId;
        event.eventType = endedBreakType === 'personal' ? 'PERSONAL_END' : 'LUNCH_END';
        event.occurredAt = now;
        if (endedBreakType === 'personal') {
          event.reason = 'PERSONAL_TIME';
        }
      });

      queuedEvents.push(
        createClockEvent({
          sessionId: activeSession.id,
          userId,
          eventType: endedBreakType === 'personal' ? 'PERSONAL_END' : 'LUNCH_END',
          occurredAt: now,
          date: activeSession.date,
          clockInAt: activeSession.clockInAt,
          reason: endedBreakType === 'personal' ? 'PERSONAL_TIME' : undefined,
        }),
      );
    }

    await activeSession.update((session) => {
      session.clockOutAt = now;
      session.status = 'CLOCKED_OUT';
      session.clockOutTicketId = ticketId || undefined;
    });

    await eventsCollection.create((event) => {
      event.sessionId = activeSession.id;
      event.userId = userId;
      event.eventType = 'CLOCK_OUT';
      event.occurredAt = now;
      event.ticketId = ticketId || undefined;
    });
  });

  queuedEvents.push(
    createClockEvent({
      sessionId: activeSession.id,
      userId,
      eventType: 'CLOCK_OUT',
      occurredAt: now,
      date: activeSession.date,
      clockInAt: activeSession.clockInAt,
      clockOutAt: now,
      status: 'CLOCKED_OUT',
      ticketId: ticketId || undefined,
    }),
  );

  for (const event of queuedEvents) {
    await SyncEngine.queueEvent(event);
  }

  logger.log('[Timesheet] Closed active session', {
    sessionId: activeSession.id,
    endedBreakType,
    ticketId: ticketId || null,
  });

  return {
    closed: true,
    session: activeSession,
    endedBreakType,
  };
}

/**
 * Server-side active session check.
 *
 * Queries the Backend timesheet sync endpoint to see if the user already
 * has an ACTIVE session (e.g. from another device). This is the
 * multi-device guard that prevents Device B from creating a duplicate
 * local clock-in when Device A already clocked in.
 *
 * Returns the active session ID if one exists, or null if not. If the
 * network is unavailable or the request fails, returns null (allowing
 * the offline-first local clock-in to proceed; the server will refuse
 * the duplicate when the outbox flushes).
 */
export async function checkServerActiveSession(userId: string): Promise<{
  activeSessionId: string | null;
  sessions: any[];
  clockEvents: any[];
}> {
  try {
    const token = await getAuthTokenForTimesheet();
    if (!token) {
      logger.log('[Validation] No auth token, skipping server session check');
      return { activeSessionId: null, sessions: [], clockEvents: [] };
    }

    const url = `${API_BASE_URL}${ENDPOINTS.timesheetSync}?userId=${encodeURIComponent(userId)}&lastSyncAt=0`;
    const response = await fetchWithTimeoutForTimesheet(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      logger.warn('[Validation] Server session check failed:', response.status);
      return { activeSessionId: null, sessions: [], clockEvents: [] };
    }

    const data = await response.json();
    return {
      activeSessionId: data.activeSessionId || null,
      sessions: data.sessions || [],
      clockEvents: data.clockEvents || [],
    };
  } catch (error) {
    logger.warn('[Validation] Server session check error (likely offline):', error);
    return { activeSessionId: null, sessions: [], clockEvents: [] };
  }
}

// Local helpers to avoid circular imports with SyncEngine
async function getAuthTokenForTimesheet(): Promise<string | null> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    return await AsyncStorage.getItem('@locate720:auth_token');
  } catch {
    return null;
  }
}

async function fetchWithTimeoutForTimesheet(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const { fetchWithTimeout } = await import('../../../utils/fetchWithTimeout');
  return fetchWithTimeout(url, { ...options, timeout: 10000 });
}
