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

  // District Manager can view all
  if (viewer.role === ROLES.DISTRICT_MANAGER) return true;

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
  'ALLOCATION_CHANGE',
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
        clock_in_reason,
        allocation_type,
        other_reason,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        date = COALESCE(excluded.date, day_sessions.date),
        clock_in_at = COALESCE(excluded.clock_in_at, day_sessions.clock_in_at),
        clock_out_at = COALESCE(excluded.clock_out_at, day_sessions.clock_out_at),
        clock_out_ticket_id = COALESCE(excluded.clock_out_ticket_id, day_sessions.clock_out_ticket_id),
        status = COALESCE(excluded.status, day_sessions.status),
        clock_in_reason = COALESCE(excluded.clock_in_reason, day_sessions.clock_in_reason),
        allocation_type = COALESCE(excluded.allocation_type, day_sessions.allocation_type),
        other_reason = COALESCE(excluded.other_reason, day_sessions.other_reason),
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
    findOpenAllocationSegment: db.prepare(`
      SELECT id, allocation_type FROM allocation_segments
      WHERE session_id = ? AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
    `),
    insertAllocationSegment: db.prepare(`
      INSERT INTO allocation_segments (
        id, session_id, user_id, allocation_type, other_reason,
        started_at, ended_at, start_event_request_id, end_event_request_id,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    closeAllocationSegment: db.prepare(`
      UPDATE allocation_segments
      SET ended_at = COALESCE(?, ended_at),
          end_event_request_id = COALESCE(?, end_event_request_id),
          updated_at = ?
      WHERE id = ?
    `),
    closeAllOpenAllocationSegments: db.prepare(`
      UPDATE allocation_segments
      SET ended_at = COALESCE(ended_at, ?),
          updated_at = ?
      WHERE session_id = ? AND ended_at IS NULL
    `),
    closePriorActiveSessions: db.prepare(`
      UPDATE day_sessions
      SET status = 'CLOCKED_OUT',
          clock_out_at = COALESCE(clock_out_at, ?),
          updated_at = ?
      WHERE user_id = ? AND status = 'ACTIVE' AND id != ?
    `),
    closeOpenBreaksForUser: db.prepare(`
      UPDATE break_segments
      SET ended_at = COALESCE(ended_at, ?),
          updated_at = ?
      WHERE user_id = ? AND ended_at IS NULL
        AND session_id != ?
    `),
    updateSessionAllocation: db.prepare(`
      UPDATE day_sessions
      SET allocation_type = ?,
          other_reason = COALESCE(?, other_reason),
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
        closePriorActiveSessions,
        closeOpenBreaksForUser,
        updateSessionAllocation,
        findOpenAllocationSegment,
        insertAllocationSegment,
        closeAllocationSegment,
        closeAllOpenAllocationSegments,
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
        clockInReason,
        allocationType,
        otherReason,
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
        eventType === 'CLOCK_IN' ? (clockInReason || null) : null,
        allocationType || null,
        otherReason || null,
        now,
        now,
      );

      if (eventType === 'CLOCK_IN') {
        // Close any prior active sessions for this user (prevents duplicate active sessions)
        closePriorActiveSessions.run(occurredAt, now, userId, sessionId);
        // Close any open break segments on those prior sessions
        closeOpenBreaksForUser.run(occurredAt, now, userId, sessionId);
        updateSessionClockIn.run(clockInAt || occurredAt, now, sessionId);
        // Start the first allocation segment for this session
        insertAllocationSegment.run(
          `${requestId}:alloc`,
          sessionId,
          userId,
          allocationType || clockInReason || 'locating',
          otherReason || null,
          clockInAt || occurredAt,
          null,
          requestId,
          null,
          now,
          now,
        );
      }

      if (eventType === 'CLOCK_OUT') {
        updateSessionClockOut.run(clockOutAt || occurredAt, ticketId || null, now, sessionId);
        // Close any open allocation segment
        closeAllOpenAllocationSegments.run(clockOutAt || occurredAt, now, sessionId);
      }

      if (eventType === 'ALLOCATION_CHANGE') {
        // Update allocation type on the existing session without
        // re-triggering clock-in logic (no prior session closure, no
        // clock_in_at change).
        updateSessionAllocation.run(
          allocationType || null,
          otherReason || null,
          now,
          sessionId,
        );
        // Close the current open allocation segment and start a new one
        const openSeg = findOpenAllocationSegment.get(sessionId);
        if (openSeg) {
          closeAllocationSegment.run(occurredAt, requestId, now, openSeg.id);
        }
        insertAllocationSegment.run(
          `${requestId}:alloc`,
          sessionId,
          userId,
          allocationType || 'locating',
          otherReason || null,
          occurredAt,
          null,
          requestId,
          openSeg ? openSeg.end_event_request_id : null,
          now,
          now,
        );
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
        const { sessionId, userId, eventType, occurredAt, force } = payload;

        // Ensure the user exists in the backend DB before inserting FK-dependent rows.
        // Mobile may send events for users that only exist in WatermelonDB.
        ensureUserExists(userId);

        // Multi-device guard: refuse a new CLOCK_IN if the user already
        // has an ACTIVE session on another device. This prevents Device B
        // from silently closing Device A's session. The client may set
        // `force: true` in the payload to override (admin/force flow),
        // which preserves the legacy closePriorActiveSessions behavior.
        if (eventType === 'CLOCK_IN' && !force) {
          const existingActive = db.prepare(`
            SELECT id FROM day_sessions
            WHERE user_id = ? AND status = 'ACTIVE' AND id != ?
          `).get(userId, sessionId);

          if (existingActive) {
            const refuseResult = {
              requestId,
              status: 'ERROR',
              error: 'ALREADY_CLOCKED_IN',
              message: `User already has an active session (${existingActive.id.slice(0, 8)}) on another device`,
              activeSessionId: existingActive.id,
            };
            markEventProcessed(requestId, refuseResult);
            results.push(refuseResult);
            console.log(`[Timesheet] Refused duplicate CLOCK_IN for user ${userId}: active session ${existingActive.id}`);
            continue;
          }
        }

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

/**
 * GET /api/timesheet/sync
 * Delta-pull endpoint for mobile reconciliation.
 *
 * Returns day_sessions and clock_events for a user that changed since
 * `lastSyncAt`. If `lastSyncAt` is omitted, returns today's sessions plus
 * any active session (so a fresh device can discover an existing clock-in
 * from another device).
 *
 * This is the server-authoritative counterpart to the mobile outbox P1
 * flush. Mobile calls this on sync ticks and on app foreground to
 * reconcile local day_sessions/clock_events with Backend truth.
 */
router.get('/sync', (req, res) => {
  const { userId, lastSyncAt } = req.query;
  const viewer = getUserFromRequest(req);

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  // Permission check (self or supervisor+)
  if (viewer && !canViewTimesheet(viewer, userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const since = lastSyncAt ? Number(lastSyncAt) : 0;
  const today = new Date().toISOString().split('T')[0];

  // Fetch sessions updated since lastSyncAt. If no lastSyncAt, also
  // include today's session and any ACTIVE session regardless of date
  // (so a freshly-launched app discovers an active clock-in from
  // another device).
  let sessionQuery = `
    SELECT * FROM day_sessions
    WHERE user_id = ? AND updated_at > ?
  `;
  const sessionParams = [userId, since];

  if (since === 0) {
    sessionQuery += `
      UNION
      SELECT * FROM day_sessions
      WHERE user_id = ? AND (date = ? OR status = 'ACTIVE')
    `;
    sessionParams.push(userId, today);
  }

  sessionQuery += ' ORDER BY date DESC, clock_in_at DESC';

  const sessions = db.prepare(sessionQuery).all(...sessionParams);

  // Deduplicate by id (UNION can produce duplicates)
  const seenSessionIds = new Set();
  const uniqueSessions = sessions.filter((s) => {
    if (seenSessionIds.has(s.id)) return false;
    seenSessionIds.add(s.id);
    return true;
  });

  // Fetch clock events for those sessions
  const sessionIds = uniqueSessions.map((s) => s.id);
  let events = [];
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => '?').join(',');
    events = db.prepare(`
      SELECT * FROM clock_events
      WHERE session_id IN (${placeholders})
      ORDER BY occurred_at ASC
    `).all(...sessionIds);
  }

  // Fetch break segments for those sessions (mobile doesn't have this
  // table locally, but the timeline data is useful for the detailed
  // timesheet view).
  let breakSegments = [];
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => '?').join(',');
    breakSegments = db.prepare(`
      SELECT * FROM break_segments
      WHERE session_id IN (${placeholders})
      ORDER BY started_at ASC
    `).all(...sessionIds);
  }

  // Fetch allocation segments for those sessions
  let allocationSegments = [];
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => '?').join(',');
    allocationSegments = db.prepare(`
      SELECT * FROM allocation_segments
      WHERE session_id IN (${placeholders})
      ORDER BY started_at ASC
    `).all(...sessionIds);
  }

  // Find the current active session (if any) for quick reference
  const activeSession = uniqueSessions.find((s) => s.status === 'ACTIVE') || null;

  res.json({
    userId,
    serverTime: Date.now(),
    activeSessionId: activeSession?.id || null,
    sessions: uniqueSessions,
    clockEvents: events,
    breakSegments,
    allocationSegments,
  });
});

export default router;
