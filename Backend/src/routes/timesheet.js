import express from 'express';
import { db } from '../server.js';
import {
  getProcessedEventResult,
  isEventProcessed,
  markEventProcessed,
} from '../services/idempotencyService.js';
import { emitOpsEvent } from '../utils/opsEventBus.js';
import { hasRoleLevel, ROLES } from '../utils/permissions.js';

const router = express.Router();

/**
 * Ensure a user row exists in the backend DB. Mobile devices may send clock
 * events referencing a user id that only exists in WatermelonDB (e.g. the
 * hardcoded DEV_USER_ID or a locally-generated UUID). If the user is missing,
 * create a minimal placeholder row so FK constraints on clock_events,
 * day_sessions, and break_segments don't fail.
 */
function ensureUserExists(userId) {
  if (!userId) return;
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (existing) return;
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (id, name, email, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 'TECH', 1, ?, ?)
  `).run(userId, `Mobile User ${userId.slice(0, 8)}`, `${userId.slice(0, 8)}@mobile.local`, now, now);
  console.log(`[Timesheet] Auto-created placeholder user ${userId} for clock event`);
}

/**
 * Helper to get user from request (supports JWT auth or query param for dev)
 */
function getUserFromRequest(req) {
  // If JWT auth is available (from ops middleware), use it
  if (req.user) return req.user;

  // Fallback: lookup by userId query param or header (for dev/mobile testing)
  const userId = req.query.viewerId || req.headers['x-user-id'];
  if (userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return user;
  }
  return null;
}

/**
 * Check if viewer can access target user's timesheet data
 */
function canViewTimesheet(viewer, targetUserId) {
  if (!viewer) return false;

  // Self access
  if (viewer.id === targetUserId) return true;

  // Manager can view all
  if (viewer.role === ROLES.MANAGER) return true;

  // Area manager can view users in their area
  if (viewer.role === ROLES.AREA_MANAGER) {
    const targetUser = db.prepare('SELECT area_id FROM users WHERE id = ?').get(targetUserId);
    return targetUser && targetUser.area_id === viewer.area_id;
  }

  // Supervisor can view their direct reports (and reports of reports)
  if (viewer.role === ROLES.SUPERVISOR) {
    // Check if targetUser is in the supervisor's chain
    const targetUser = db.prepare('SELECT supervisor_id, area_id FROM users WHERE id = ?').get(targetUserId);
    if (!targetUser) return false;
    // Direct report or same area
    return targetUser.supervisor_id === viewer.id || targetUser.area_id === viewer.area_id;
  }

  return false;
}

const validClockEventTypes = new Set([
  'CLOCK_IN',
  'CLOCK_OUT',
  'LUNCH_START',
  'LUNCH_END',
  'PERSONAL_START',
  'PERSONAL_END',
]);

function validateClockEvent(event) {
  if (!event || typeof event !== 'object') {
    return 'Invalid event object';
  }

  if (event.type !== 'CLOCK_EVENT') {
    return 'Unsupported timesheet event type';
  }

  if (!event.requestId || typeof event.requestId !== 'string') {
    return 'Missing requestId';
  }

  if (!event.payload || typeof event.payload !== 'object') {
    return 'Missing payload';
  }

  const { sessionId, userId, eventType, occurredAt } = event.payload;

  if (!sessionId || typeof sessionId !== 'string') {
    return 'Missing sessionId';
  }

  if (!userId || typeof userId !== 'string') {
    return 'Missing userId';
  }

  if (!validClockEventTypes.has(eventType)) {
    return `Invalid eventType: ${eventType}`;
  }

  if (typeof occurredAt !== 'number' || Number.isNaN(occurredAt)) {
    return 'Invalid occurredAt';
  }

  return null;
}

let statements;
let persistClockEventTx;

function getStatements() {
  if (statements) {
    return statements;
  }

  statements = {
    upsertDaySession: db.prepare(`
      INSERT INTO day_sessions (
        id,
        user_id,
        date,
        clock_in_at,
        clock_out_at,
        clock_out_ticket_id,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        date = COALESCE(excluded.date, day_sessions.date),
        clock_in_at = COALESCE(excluded.clock_in_at, day_sessions.clock_in_at),
        clock_out_at = COALESCE(excluded.clock_out_at, day_sessions.clock_out_at),
        clock_out_ticket_id = COALESCE(excluded.clock_out_ticket_id, day_sessions.clock_out_ticket_id),
        status = COALESCE(excluded.status, day_sessions.status),
        updated_at = excluded.updated_at
    `),
    insertClockEvent: db.prepare(`
      INSERT INTO clock_events (
        id,
        request_id,
        session_id,
        user_id,
        event_type,
        occurred_at,
        reason,
        ticket_id,
        device_id,
        seq,
        date,
        clock_in_at,
        clock_out_at,
        session_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateSessionClockIn: db.prepare(`
      UPDATE day_sessions
      SET clock_in_at = COALESCE(?, clock_in_at),
          status = 'ACTIVE',
          updated_at = ?
      WHERE id = ?
    `),
    updateSessionClockOut: db.prepare(`
      UPDATE day_sessions
      SET clock_out_at = COALESCE(?, clock_out_at),
          clock_out_ticket_id = COALESCE(?, clock_out_ticket_id),
          status = 'CLOCKED_OUT',
          updated_at = ?
      WHERE id = ?
    `),
    findLatestOpenBreakSegment: db.prepare(`
      SELECT id
      FROM break_segments
      WHERE session_id = ? AND break_type = ? AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
    `),
    insertBreakSegment: db.prepare(`
      INSERT INTO break_segments (
        id,
        session_id,
        user_id,
        break_type,
        started_at,
        ended_at,
        reason,
        start_event_request_id,
        end_event_request_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    closeBreakSegment: db.prepare(`
      UPDATE break_segments
      SET ended_at = COALESCE(?, ended_at),
          reason = COALESCE(?, reason),
          end_event_request_id = COALESCE(?, end_event_request_id),
          updated_at = ?
      WHERE id = ?
    `),
  };

  return statements;
}

function persistClockEvent(event) {
  if (!persistClockEventTx) {
    persistClockEventTx = db.transaction((txEvent) => {
      const {
        upsertDaySession,
        insertClockEvent,
        updateSessionClockIn,
        updateSessionClockOut,
        findLatestOpenBreakSegment,
        insertBreakSegment,
        closeBreakSegment,
      } = getStatements();
      const { requestId, deviceId, seq, payload } = txEvent;
      const {
        sessionId,
        userId,
        eventType,
        occurredAt,
        reason,
        ticketId,
        date,
        clockInAt,
        clockOutAt,
        status,
      } = payload;
      const now = Date.now();

      upsertDaySession.run(
        sessionId,
        userId,
        date || null,
        eventType === 'CLOCK_IN' ? (clockInAt || occurredAt) : clockInAt || null,
        eventType === 'CLOCK_OUT' ? (clockOutAt || occurredAt) : null,
        eventType === 'CLOCK_OUT' ? (ticketId || null) : null,
        status || (eventType === 'CLOCK_OUT' ? 'CLOCKED_OUT' : 'ACTIVE'),
        now,
        now,
      );

      if (eventType === 'CLOCK_IN') {
        updateSessionClockIn.run(clockInAt || occurredAt, now, sessionId);
      }

      if (eventType === 'CLOCK_OUT') {
        updateSessionClockOut.run(clockOutAt || occurredAt, ticketId || null, now, sessionId);
      }

      if (eventType === 'LUNCH_START' || eventType === 'PERSONAL_START') {
        const breakType = eventType === 'LUNCH_START' ? 'LUNCH' : 'PERSONAL';
        const existingSegment = findLatestOpenBreakSegment.get(sessionId, breakType);

        if (!existingSegment) {
          insertBreakSegment.run(
            `${requestId}:${breakType}`,
            sessionId,
            userId,
            breakType,
            occurredAt,
            null,
            reason || null,
            requestId,
            null,
            now,
            now,
          );
        }
      }

      if (eventType === 'LUNCH_END' || eventType === 'PERSONAL_END') {
        const breakType = eventType === 'LUNCH_END' ? 'LUNCH' : 'PERSONAL';
        const existingSegment = findLatestOpenBreakSegment.get(sessionId, breakType);

        if (existingSegment) {
          closeBreakSegment.run(
            occurredAt,
            reason || null,
            requestId,
            now,
            existingSegment.id,
          );
        }
      }

      insertClockEvent.run(
        requestId,
        requestId,
        sessionId,
        userId,
        eventType,
        occurredAt,
        reason || null,
        ticketId || null,
        deviceId || null,
        typeof seq === 'number' ? seq : null,
        date || null,
        clockInAt || null,
        clockOutAt || null,
        status || null,
      );
    });
  }

  return persistClockEventTx(event);
}

function calculateBreakTotals(events) {
  let lunchMs = 0;
  let personalMs = 0;
  let activeLunchStart = null;
  let activePersonalStart = null;

  for (const event of events) {
    if (event.event_type === 'LUNCH_START') {
      activeLunchStart = event.occurred_at;
    } else if (event.event_type === 'LUNCH_END' && activeLunchStart) {
      lunchMs += Math.max(0, event.occurred_at - activeLunchStart);
      activeLunchStart = null;
    } else if (event.event_type === 'PERSONAL_START') {
      activePersonalStart = event.occurred_at;
    } else if (event.event_type === 'PERSONAL_END' && activePersonalStart) {
      personalMs += Math.max(0, event.occurred_at - activePersonalStart);
      activePersonalStart = null;
    }
  }

  return { lunchMs, personalMs };
}

function buildSessionsResponse(sessions) {
  const eventsBySession = db.prepare(`
    SELECT *
    FROM clock_events
    WHERE session_id = ?
    ORDER BY occurred_at ASC
  `);
  const breakSegmentsBySession = db.prepare(`
    SELECT *
    FROM break_segments
    WHERE session_id = ?
    ORDER BY started_at ASC
  `);

  return sessions.map((session) => ({
    ...session,
    events: eventsBySession.all(session.id),
    breakSegments: breakSegmentsBySession.all(session.id),
  }));
}

/**
 * POST /api/timesheet/events
 * Receive clock events from mobile app (clock in/out, lunch, personal time)
 */
router.post('/events', (req, res) => {
  const { events } = req.body;
  
  if (!events || !Array.isArray(events)) {
    return res.status(400).json({ error: 'Invalid events array' });
  }

  console.log('[Timesheet] Received', events.length, 'clock events from mobile app');

  const results = [];

  for (const event of events) {
    try {
      const { type, requestId, payload } = event;
      
      console.log('[Timesheet] Processing event:', type, 'requestId:', requestId);

      if (isEventProcessed(requestId)) {
        const cachedResult = getProcessedEventResult(requestId);
        results.push(cachedResult);
        continue;
      }

      const validationError = validateClockEvent(event);
      if (validationError) {
        const errorResult = { requestId, status: 'ERROR', error: validationError };
        markEventProcessed(requestId, errorResult);
        results.push(errorResult);
        continue;
      }

      if (type === 'CLOCK_EVENT') {
        const { sessionId, userId, eventType, occurredAt } = payload;

        // Ensure the user exists in the backend DB before inserting FK-dependent rows.
        // Mobile may send events for users that only exist in WatermelonDB.
        ensureUserExists(userId);

        persistClockEvent(event);
        console.log(`[Timesheet] Clock event: ${eventType} for user ${userId} at ${new Date(occurredAt).toLocaleString()}`);

        emitOpsEvent('tech.clock.changed', {
          userId,
          sessionId,
          eventType,
          occurredAt,
        });

        const successResult = { requestId, status: 'OK', sessionId };
        markEventProcessed(requestId, successResult);
        results.push(successResult);
      } 
      else {
        console.log('[Timesheet] Unknown event type:', type);
        const ignoredResult = { requestId, status: 'IGNORED', reason: 'Unknown event type' };
        markEventProcessed(requestId, ignoredResult);
        results.push(ignoredResult);
      }
    } catch (error) {
      console.error(
        '[Timesheet] Error processing event:',
        error.message,
        '| userId:',
        event?.payload?.userId || '?',
        '| sessionId:',
        event?.payload?.sessionId || '?',
        '| ticketId:',
        event?.payload?.ticketId || 'none',
      );
      const errorResult = { 
        requestId: event.requestId, 
        status: 'ERROR', 
        error: error.message 
      };
      if (event.requestId) {
        markEventProcessed(event.requestId, errorResult);
      }
      results.push(errorResult);
    }
  }

  res.json({ results });
});

/**
 * GET /api/timesheet/sessions
 * Get timesheet sessions for a user
 * Permission-based: users can view own timesheet; supervisors+ can view reports
 */
router.get('/sessions', (req, res) => {
  const { userId, startDate, endDate } = req.query;
  const viewer = getUserFromRequest(req);

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  // Permission check
  if (viewer && !canViewTimesheet(viewer, userId)) {
    return res.status(403).json({ error: 'Access denied - you cannot view this timesheet' });
  }

  console.log('[Timesheet] Fetching sessions for user:', userId);

  let query = `
    SELECT *
    FROM day_sessions
    WHERE user_id = ?
  `;
  const params = [userId];

  if (startDate) {
    query += ' AND date >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND date <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY date DESC, clock_in_at DESC';

  const sessions = db.prepare(query).all(...params);
  res.json({
    sessions: buildSessionsResponse(sessions),
  });
});

/**
 * GET /api/timesheet/summary
 * Get aggregated timesheet totals for a user and date range
 * Permission-based: users can view own summary; supervisors+ can view reports
 */
router.get('/summary', (req, res) => {
  const { userId, startDate, endDate } = req.query;
  const viewer = getUserFromRequest(req);

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  // Permission check
  if (viewer && !canViewTimesheet(viewer, userId)) {
    return res.status(403).json({ error: 'Access denied - you cannot view this timesheet' });
  }

  let query = `
    SELECT *
    FROM day_sessions
    WHERE user_id = ?
  `;
  const params = [userId];

  if (startDate) {
    query += ' AND date >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND date <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY date DESC, clock_in_at DESC';

  const sessions = db.prepare(query).all(...params);
  const hydratedSessions = buildSessionsResponse(sessions);

  const summary = hydratedSessions.reduce(
    (acc, session) => {
      const workedMs =
        session.clock_in_at && session.clock_out_at
          ? Math.max(0, session.clock_out_at - session.clock_in_at)
          : 0;
      const { lunchMs, personalMs } = calculateBreakTotals(session.events);

      acc.sessionCount += 1;
      acc.totalWorkedMs += workedMs;
      acc.totalLunchMs += lunchMs;
      acc.totalPersonalMs += personalMs;

      if (session.status === 'ACTIVE') {
        acc.activeSessionCount += 1;
      }

      return acc;
    },
    {
      sessionCount: 0,
      activeSessionCount: 0,
      totalWorkedMs: 0,
      totalLunchMs: 0,
      totalPersonalMs: 0,
    },
  );

  res.json({
    userId,
    startDate: startDate || null,
    endDate: endDate || null,
    summary,
    sessions: hydratedSessions,
  });
});

export default router;
