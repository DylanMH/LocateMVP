import express from 'express';
import { db } from '../server.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

function getTodayStartMs() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function parsePayload(payloadJson) {
  try {
    return JSON.parse(payloadJson || '{}');
  } catch {
    return {};
  }
}

function getNested811Payload(payload) {
  const originalTicketData = payload?.originalTicketData || {};

  if (originalTicketData.payload && typeof originalTicketData.payload === 'object') {
    return originalTicketData.payload;
  }

  if (typeof originalTicketData.payloadJson === 'string' && originalTicketData.payloadJson) {
    try {
      return JSON.parse(originalTicketData.payloadJson);
    } catch {
      return {};
    }
  }

  return {};
}

function getEffectiveEndTime(payload, locatorStatus) {
  if (payload.closedAt) {
    return payload.closedAt;
  }

  if (locatorStatus === 'CLOSED' || locatorStatus === 'UNABLE') {
    if (payload.onsiteEndedAt) return payload.onsiteEndedAt;
    if (payload.onsiteStartedAt) return payload.onsiteStartedAt;
  }

  if (locatorStatus === 'PAUSED' && Array.isArray(payload.pauseEvents) && payload.pauseEvents.length > 0) {
    const lastPause = payload.pauseEvents[payload.pauseEvents.length - 1];
    if (lastPause && !lastPause.end) {
      return lastPause.start;
    }
  }

  return Date.now();
}

function getPausedMillis(payload) {
  if (!Array.isArray(payload.pauseEvents) || payload.pauseEvents.length === 0) {
    return 0;
  }

  return payload.pauseEvents.reduce((total, pause) => {
    const end = pause.end ?? Date.now();
    return total + Math.max(0, end - pause.start);
  }, 0);
}

function getPausedMillisWithinOnsite(payload, effectiveEndTime) {
  if (!payload.onsiteStartedAt || !Array.isArray(payload.pauseEvents) || payload.pauseEvents.length === 0) {
    return 0;
  }

  const onsiteStart = payload.onsiteStartedAt;
  const onsiteEnd = payload.onsiteEndedAt ?? effectiveEndTime;

  return payload.pauseEvents.reduce((total, pause) => {
    if (pause.start >= onsiteStart && pause.start <= onsiteEnd) {
      const end = pause.end ?? effectiveEndTime;
      return total + Math.max(0, Math.min(end, onsiteEnd) - pause.start);
    }
    return total;
  }, 0);
}

function getOnsiteMillis(payload, locatorStatus) {
  if (!payload.onsiteStartedAt) {
    return 0;
  }

  const endTime = getEffectiveEndTime(payload, locatorStatus);
  const rawDuration = endTime - payload.onsiteStartedAt;
  const pausedWithinOnsite = getPausedMillisWithinOnsite(payload, endTime);
  return Math.max(0, rawDuration - pausedWithinOnsite);
}

function getEnrouteMillis(payload, locatorStatus) {
  if (!payload.enrouteStartedAt) {
    return 0;
  }

  const endTime = payload.enrouteEndedAt ?? getEffectiveEndTime(payload, locatorStatus);
  return Math.max(0, endTime - payload.enrouteStartedAt);
}

function buildCustomerLookup(payload) {
  const nestedPayload = getNested811Payload(payload);
  const customers = [
    ...(Array.isArray(payload.customers) ? payload.customers : []),
    ...(Array.isArray(nestedPayload.customers) ? nestedPayload.customers : []),
  ];

  const lookup = new Map();
  for (const customer of customers) {
    if (customer?.id && !lookup.has(customer.id)) {
      lookup.set(customer.id, customer);
    }
  }
  return lookup;
}

/**
 * GET /api/users
 * Get all users
 */
router.get('/', (req, res) => {
  const { role } = req.query;
  
  let query = 'SELECT * FROM users';
  const params = [];
  
  if (role) {
    query += ' WHERE role = ?';
    params.push(role);
  }
  
  const users = db.prepare(query).all(...params);
  res.json({ users });
});

/**
 * GET /api/users/:id/productivity-summary
 * Get aggregated productivity metrics for a user
 */
router.get('/:id/productivity-summary', (req, res) => {
  const userId = req.params.id;
  const user = db.prepare(`
    SELECT
      u.*,
      supervisor.name as supervisor_name
    FROM users u
    LEFT JOIN users supervisor ON supervisor.id = u.supervisor_id
    WHERE u.id = ?
  `).get(userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const todayStartMs = getTodayStartMs();
  const todayDate = getTodayDateString();

  const ticketCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN locator_status NOT IN ('CLOSED', 'UNABLE') THEN 1 ELSE 0 END) as tickets_on_board,
      SUM(CASE WHEN closed_at >= ? THEN 1 ELSE 0 END) as closed_today
    FROM tickets
    WHERE assigned_tech_id = ?
  `).get(todayStartMs, userId);

  const productionTotals = db.prepare(`
    SELECT
      COALESCE(SUM(footage_delta), 0) as total_footage_allocated,
      COALESCE(SUM(completed_delta), 0) as total_utilities_closed,
      COALESCE(SUM(minutes_delta), 0) as total_utility_minutes
    FROM utility_production_ledger
    WHERE user_id = ? AND occurred_at >= ?
  `).get(userId, todayStartMs);

  const workedTotals = db.prepare(`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL AND clock_out_at > clock_in_at
            THEN clock_out_at - clock_in_at
          WHEN clock_in_at IS NOT NULL AND status = 'ACTIVE'
            THEN ? - clock_in_at
          ELSE 0
        END
      ), 0) as total_worked_ms
    FROM day_sessions
    WHERE user_id = ? AND date = ?
  `).get(Date.now(), userId, todayDate);

  const activeSession = db.prepare(`
    SELECT id, clock_in_at
    FROM day_sessions
    WHERE user_id = ? AND date = ? AND status = 'ACTIVE'
    ORDER BY clock_in_at DESC
    LIMIT 1
  `).get(userId, todayDate);

  const totalWorkedMs = workedTotals.total_worked_ms || 0;
  const totalWorkedHours = totalWorkedMs / 3600000;
  const totalFootageAllocated = productionTotals.total_footage_allocated || 0;
  const totalUtilitiesClosed = productionTotals.total_utilities_closed || 0;

  res.json({
    userId,
    supervisor: user.supervisor_name || null,
    ticketsOnBoard: ticketCounts.tickets_on_board || 0,
    closedToday: ticketCounts.closed_today || 0,
    totalFootageAllocated,
    totalUtilitiesClosed,
    totalUtilityMinutes: productionTotals.total_utility_minutes || 0,
    accumulatedClockInTimeMs: totalWorkedMs,
    accumulatedClockInTime: formatDuration(totalWorkedMs),
    activeSessionId: activeSession?.id || null,
    activeSessionClockInAt: activeSession?.clock_in_at || null,
    lph: totalWorkedHours > 0 ? totalUtilitiesClosed / totalWorkedHours : 0,
    fph: totalWorkedHours > 0 ? totalFootageAllocated / totalWorkedHours : 0,
  });
});

/**
 * GET /api/users/:id/utility-production-summary
 * Get utility production totals plus current ticket utility states
 */
router.get('/:id/utility-production-summary', (req, res) => {
  const userId = req.params.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const utilityTotals = db.prepare(`
    SELECT
      utility_type as utilityType,
      COALESCE(SUM(minutes_delta), 0) as totalMinutes,
      COALESCE(SUM(footage_delta), 0) as totalFootage,
      COALESCE(SUM(completed_delta), 0) as completedCount
    FROM utility_production_ledger
    WHERE user_id = ?
    GROUP BY utility_type
    ORDER BY utility_type ASC
  `).all(userId);

  const tickets = db.prepare(`
    SELECT id, ticket_number, locator_status, payload_json
    FROM tickets
    WHERE assigned_tech_id = ?
    ORDER BY updated_at DESC
  `).all(userId);

  const ticketSummaries = tickets.map((ticket) => {
    const payload = parsePayload(ticket.payload_json);
    const customerMarking = payload.customerMarkings || payload.customerMarking || {};
    const customerLookup = buildCustomerLookup(payload);
    const enrouteMillis = getEnrouteMillis(payload, ticket.locator_status);
    const onsiteMillis = getOnsiteMillis(payload, ticket.locator_status);
    const pausedMillis = getPausedMillis(payload);

    return {
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      locatorStatus: ticket.locator_status,
      enrouteMinutes: Math.floor(enrouteMillis / 60000),
      onsiteMinutes: Math.floor(onsiteMillis / 60000),
      pausedMinutes: Math.floor(pausedMillis / 60000),
      totalTicketMinutes: Math.floor((enrouteMillis + onsiteMillis + pausedMillis) / 60000),
      utilities: Object.entries(customerMarking).map(([customerId, marking]) => {
        const customer = customerLookup.get(customerId);
        return {
          customerId,
          customerName: customer?.name || null,
          utilityType: customer?.utility || null,
          status: marking?.status || '',
          result: marking?.result || '',
          minutes: marking?.minutes || '0',
          footage: marking?.footage || '0',
          completed: marking?.completed === true,
        };
      }),
    };
  });

  const timeTotals = ticketSummaries.reduce(
    (acc, ticket) => {
      acc.enrouteMinutes += ticket.enrouteMinutes;
      acc.onsiteMinutes += ticket.onsiteMinutes;
      acc.pausedMinutes += ticket.pausedMinutes;
      acc.totalTicketMinutes += ticket.totalTicketMinutes;
      return acc;
    },
    {
      enrouteMinutes: 0,
      onsiteMinutes: 0,
      pausedMinutes: 0,
      totalTicketMinutes: 0,
    },
  );

  res.json({
    userId,
    utilityTotals,
    timeTotals,
    tickets: ticketSummaries,
  });
});

/**
 * GET /api/users/:id
 * Get a single user by ID
 */
router.get('/:id', (req, res) => {
  const user = db.prepare(`
    SELECT
      u.*,
      supervisor.name as supervisor_name
    FROM users u
    LEFT JOIN users supervisor ON supervisor.id = u.supervisor_id
    WHERE u.id = ?
  `).get(req.params.id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json(user);
});

/**
 * POST /api/users
 * Create a new user
 */
router.post('/', (req, res) => {
  const { name, email, role, supervisorId = null } = req.body;

  if (!name || !email || !role) {
    return res.status(400).json({ error: 'Missing required fields: name, email, role' });
  }

  const validRoles = ['TRAINEE', 'TRAINER', 'TECH', 'SUPERVISOR', 'AREA_MANAGER', 'MANAGER'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be TRAINEE, TRAINER, TECH, SUPERVISOR, AREA_MANAGER, or MANAGER' });
  }

  const userId = `user-${uuidv4()}`;
  const now = Date.now();

  try {
    db.prepare(`
      INSERT INTO users (id, name, email, role, supervisor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, name, email, role, supervisorId, now);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.status(201).json(user);
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    throw error;
  }
});

/**
 * GET /api/users/:id/tickets
 * Get all tickets assigned to a user
 */
router.get('/:id/tickets', (req, res) => {
  const tickets = db.prepare(`
    SELECT * FROM tickets
    WHERE assigned_tech_id = ?
    ORDER BY due_at ASC
  `).all(req.params.id);

  res.json({
    tickets: tickets.map(t => ({
      ...t,
      payloadJson: JSON.parse(t.payload_json),
    })),
  });
});

export default router;
