import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "../server.js";
import { v4 as uuidv4 } from "uuid";
import { resolveRange, rangeToDateString } from "../utils/range.js";
import {
  emitOpsEvent,
  subscribeOpsEvents,
} from "../utils/opsEventBus.js";
import { getChainWithSummaries } from "../services/ticketChainService.js";
import {
  buildTicketVisibilityFilter,
  canUserSeeTicket,
  getUserDirectTerritories,
  getTechIdsUnderUser,
} from "../services/territoryService.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "l720-ops-secret-key";

// ---------- helpers ----------

// Locator status machine (mirrors mobile statusMachine.ts).
// MANAGER can bypass for admin overrides.
const ALLOWED_LOCATOR_TRANSITIONS = {
  PENDING: ["ASSIGNED"],   // Tech assigned → ready for field work
  ASSIGNED: ["ENROUTE"],
  ENROUTE: ["ONSITE"],
  ONSITE: ["PAUSED"],
  PAUSED: ["ONSITE"],
  CLOSED: ["ASSIGNED"],    // Reopen: return to assigned for re-locate
  UNABLE: ["ASSIGNED"],    // Reopen: return to assigned for re-locate
};

function isValidLocatorTransition(from, to) {
  return (ALLOWED_LOCATOR_TRANSITIONS[from] || []).includes(to);
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function getPausedMillis(payload) {
  if (!Array.isArray(payload.pauseEvents) || payload.pauseEvents.length === 0)
    return 0;
  return payload.pauseEvents.reduce((total, p) => {
    const end = p.end ?? Date.now();
    return total + Math.max(0, end - p.start);
  }, 0);
}

function getPausedWithinOnsite(payload, effectiveEnd) {
  if (
    !payload.onsiteStartedAt ||
    !Array.isArray(payload.pauseEvents) ||
    payload.pauseEvents.length === 0
  ) {
    return 0;
  }
  const onsiteStart = payload.onsiteStartedAt;
  const onsiteEnd = payload.onsiteEndedAt ?? effectiveEnd;
  return payload.pauseEvents.reduce((total, p) => {
    if (p.start >= onsiteStart && p.start <= onsiteEnd) {
      const end = p.end ?? effectiveEnd;
      return total + Math.max(0, Math.min(end, onsiteEnd) - p.start);
    }
    return total;
  }, 0);
}

function getEffectiveEnd(payload, locatorStatus) {
  if (payload.closedAt) return payload.closedAt;
  if (locatorStatus === "CLOSED" || locatorStatus === "UNABLE") {
    if (payload.onsiteEndedAt) return payload.onsiteEndedAt;
    if (payload.onsiteStartedAt) return payload.onsiteStartedAt;
  }
  if (locatorStatus === "PAUSED" && Array.isArray(payload.pauseEvents)) {
    const last = payload.pauseEvents[payload.pauseEvents.length - 1];
    if (last && !last.end) return last.start;
  }
  return Date.now();
}

function computeTicketTimeAllocation(ticket) {
  const payload = parseJson(ticket.payload_json);
  const effectiveEnd = getEffectiveEnd(payload, ticket.locator_status);
  const enrouteMs = payload.enrouteStartedAt
    ? Math.max(
        0,
        (payload.enrouteEndedAt ?? effectiveEnd) - payload.enrouteStartedAt,
      )
    : 0;
  const rawOnsite = payload.onsiteStartedAt
    ? Math.max(0, effectiveEnd - payload.onsiteStartedAt)
    : 0;
  const pausedWithinOnsite = getPausedWithinOnsite(payload, effectiveEnd);
  const onsiteMs = Math.max(0, rawOnsite - pausedWithinOnsite);
  const pausedMs = getPausedMillis(payload);
  return {
    enrouteMs,
    onsiteMs,
    pausedMs,
    totalMs: enrouteMs + onsiteMs + pausedMs,
    enrouteStartedAt: payload.enrouteStartedAt ?? null,
    enrouteEndedAt: payload.enrouteEndedAt ?? null,
    onsiteStartedAt: payload.onsiteStartedAt ?? null,
    onsiteEndedAt: payload.onsiteEndedAt ?? null,
    closedAt: payload.closedAt ?? ticket.closed_at ?? null,
  };
}

function getLiveClockState(userId) {
  const session = db
    .prepare(
      `SELECT id, clock_in_at, clock_out_at, status, clock_in_reason, allocation_type, other_reason, clock_out_ticket_id
       FROM day_sessions
       WHERE user_id = ? AND status = 'ACTIVE'
       ORDER BY clock_in_at DESC
       LIMIT 1`,
    )
    .get(userId);

  // No active session — look up the most recent CLOCKED_OUT session so
  // the ops page can show which ticket the tech clocked out on.
  if (!session) {
    const lastClosed = db
      .prepare(
        `SELECT id, clock_in_at, clock_out_at, clock_out_ticket_id
         FROM day_sessions
         WHERE user_id = ? AND status = 'CLOCKED_OUT'
         ORDER BY clock_out_at DESC
         LIMIT 1`,
      )
      .get(userId);

    let clockOutTicket = null;
    if (lastClosed?.clock_out_ticket_id) {
      const t = db.prepare("SELECT id, ticket_number FROM tickets WHERE id = ?").get(lastClosed.clock_out_ticket_id);
      clockOutTicket = t ? { id: t.id, ticketNumber: t.ticket_number } : null;
    }

    return {
      clockStatus: "CLOCKED_OUT",
      currentSession: lastClosed
        ? {
            sessionId: lastClosed.id,
            clockInAt: lastClosed.clock_in_at,
            clockOutAt: lastClosed.clock_out_at,
            clockOutTicket,
            currentTicket: null,
          }
        : null,
    };
  }

  const openBreak = db
    .prepare(
      `SELECT break_type, started_at
       FROM break_segments
       WHERE session_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(session.id);

  // Current allocation segment (open) — for live elapsed time per allocation
  const currentAllocSeg = db
    .prepare(
      `SELECT id, allocation_type, other_reason, started_at
       FROM allocation_segments
       WHERE session_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(session.id);

  // Resolve clock-out ticket info
  let clockOutTicket = null;
  if (session.clock_out_ticket_id) {
    const t = db.prepare("SELECT id, ticket_number FROM tickets WHERE id = ?").get(session.clock_out_ticket_id);
    clockOutTicket = t ? { id: t.id, ticketNumber: t.ticket_number } : null;
  }

  // Resolve current active ticket (ENROUTE/ONSITE/PAUSED)
  const currentTicket = getTechCurrentTicket(userId);

  return {
    clockStatus: openBreak ? `ON_${openBreak.break_type}` : "CLOCKED_IN",
    currentSession: {
      sessionId: session.id,
      clockInAt: session.clock_in_at,
      elapsedMs: Date.now() - session.clock_in_at,
      onBreak: Boolean(openBreak),
      breakType: openBreak?.break_type ?? null,
      breakStartedAt: openBreak?.started_at ?? null,
      clockInReason: session.clock_in_reason || null,
      allocationType: session.allocation_type || null,
      otherReason: session.other_reason || null,
      allocationStartedAt: currentAllocSeg?.started_at ?? session.clock_in_at,
      allocationElapsedMs: currentAllocSeg
        ? Date.now() - currentAllocSeg.started_at
        : Date.now() - session.clock_in_at,
      clockOutTicket,
      currentTicket,
    },
  };
}

function getTechAssignedTerritories(userId) {
  return db
    .prepare(
      `SELECT t.id, t.name, t.code, t.type, t.parent_territory_id
       FROM user_territory_assignments uta
       JOIN territories t ON t.id = uta.territory_id
       WHERE uta.user_id = ?
         AND uta.assignment_type = 'TECH_ASSIGNMENT'
         AND (uta.end_date IS NULL OR uta.end_date > ?)
         AND t.active = 1
       ORDER BY t.name`,
    )
    .all(userId, Date.now())
    .map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      type: t.type,
      parentTerritoryId: t.parent_territory_id,
    }));
}

function getTechCurrentTicket(userId) {
  const ticket = db
    .prepare(
      `SELECT id, ticket_number, locator_status, payload_json
       FROM tickets
       WHERE assigned_tech_id = ? AND locator_status IN ('ENROUTE', 'ONSITE', 'PAUSED')
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(userId);

  if (!ticket) return null;
  const payload = parseJson(ticket.payload_json);
  return {
    id: ticket.id,
    ticketNumber: ticket.ticket_number,
    locatorStatus: ticket.locator_status,
    enrouteStartedAt: payload.enrouteStartedAt ?? null,
    onsiteStartedAt: payload.onsiteStartedAt ?? null,
  };
}

function computeTechProductivity(userId, startMs, endMs) {
  const tickets = db
    .prepare(
      `SELECT
         SUM(CASE WHEN locator_status NOT IN ('CLOSED','UNABLE') THEN 1 ELSE 0 END) as on_board,
         SUM(CASE WHEN closed_at IS NOT NULL AND closed_at >= ? AND closed_at <= ? THEN 1 ELSE 0 END) as closed_in_range,
         SUM(CASE WHEN closed_at IS NOT NULL THEN 1 ELSE 0 END) as total_closed
       FROM tickets
       WHERE assigned_tech_id = ?`,
    )
    .get(startMs, endMs, userId);

  const production = db
    .prepare(
      `SELECT
         COALESCE(SUM(footage_delta), 0) as footage,
         COALESCE(SUM(completed_delta), 0) as locates_closed,
         COALESCE(SUM(minutes_delta), 0) as utility_minutes
       FROM utility_production_ledger
       WHERE user_id = ? AND occurred_at >= ? AND occurred_at <= ?`,
    )
    .get(userId, startMs, endMs);

  const worked = db
    .prepare(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL AND clock_out_at > clock_in_at
               THEN MIN(clock_out_at, ?) - MAX(clock_in_at, ?)
             WHEN clock_in_at IS NOT NULL AND status = 'ACTIVE'
               THEN ? - MAX(clock_in_at, ?)
             ELSE 0
           END
         ), 0) as worked_ms
       FROM day_sessions
       WHERE user_id = ?
         AND (
           (clock_in_at IS NOT NULL AND clock_in_at <= ?) OR status = 'ACTIVE'
         )
         AND (clock_out_at IS NULL OR clock_out_at >= ?)`,
    )
    .get(endMs, startMs, endMs, startMs, userId, endMs, startMs);

  const breaks = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN break_type = 'LUNCH' THEN
           (COALESCE(MIN(ended_at, ?), ?) - MAX(started_at, ?)) ELSE 0 END), 0) as lunch_ms,
         COALESCE(SUM(CASE WHEN break_type = 'PERSONAL' THEN
           (COALESCE(MIN(ended_at, ?), ?) - MAX(started_at, ?)) ELSE 0 END), 0) as personal_ms
       FROM break_segments
       WHERE user_id = ?
         AND started_at <= ?
         AND (ended_at IS NULL OR ended_at >= ?)`,
    )
    .get(endMs, endMs, startMs, endMs, endMs, startMs, userId, endMs, startMs);

  const workedMs = Math.max(0, worked.worked_ms || 0);
  const lunchMs = Math.max(0, breaks.lunch_ms || 0);
  const personalMs = Math.max(0, breaks.personal_ms || 0);
  const productiveMs = Math.max(0, workedMs - lunchMs - personalMs);
  const productiveHours = productiveMs / 3600000;
  const locatesClosed = production.locates_closed || 0;
  const footage = production.footage || 0;

  return {
    ticketsOnBoard: tickets.on_board || 0,
    ticketsClosedInRange: tickets.closed_in_range || 0,
    ticketsTotalClosed: tickets.total_closed || 0,
    locatesClosed,
    footage,
    utilityMinutes: production.utility_minutes || 0,
    workedMs,
    lunchMs,
    personalMs,
    productiveMs,
    lph: productiveHours > 0 ? locatesClosed / productiveHours : 0,
    fph: productiveHours > 0 ? footage / productiveHours : 0,
  };
}

/**
 * Compute productivity for a user, aggregating across all techs in their
 * hierarchy if the user is a supervisor or manager. For techs/trainees/
 * trainers, this is identical to computeTechProductivity.
 *
 * On board = total open tickets across all their techs.
 * Closed = total tickets closed in range across all their techs.
 * Locates, footage, utility minutes = summed across all their techs.
 * Worked/lunch/personal/productive ms = summed across all their techs.
 * LPH/FPH = total locates/footage divided by total productive hours.
 */
function computeUserProductivity(userId, role, startMs, endMs) {
  if (role === 'TECH' || role === 'TRAINEE' || role === 'TRAINER') {
    return computeTechProductivity(userId, startMs, endMs);
  }

  const techIds = getTechIdsUnderUser(db, userId, role);
  if (techIds.length === 0) {
    return {
      ticketsOnBoard: 0,
      ticketsClosedInRange: 0,
      ticketsTotalClosed: 0,
      locatesClosed: 0,
      footage: 0,
      utilityMinutes: 0,
      workedMs: 0,
      lunchMs: 0,
      personalMs: 0,
      productiveMs: 0,
      lph: 0,
      fph: 0,
    };
  }

  const ph = techIds.map(() => '?').join(',');

  const tickets = db
    .prepare(
      `SELECT
         SUM(CASE WHEN locator_status NOT IN ('CLOSED','UNABLE') THEN 1 ELSE 0 END) as on_board,
         SUM(CASE WHEN closed_at IS NOT NULL AND closed_at >= ? AND closed_at <= ? THEN 1 ELSE 0 END) as closed_in_range,
         SUM(CASE WHEN closed_at IS NOT NULL THEN 1 ELSE 0 END) as total_closed
       FROM tickets
       WHERE assigned_tech_id IN (${ph})`,
    )
    .get(startMs, endMs, ...techIds);

  const production = db
    .prepare(
      `SELECT
         COALESCE(SUM(footage_delta), 0) as footage,
         COALESCE(SUM(completed_delta), 0) as locates_closed,
         COALESCE(SUM(minutes_delta), 0) as utility_minutes
       FROM utility_production_ledger
       WHERE user_id IN (${ph}) AND occurred_at >= ? AND occurred_at <= ?`,
    )
    .get(...techIds, startMs, endMs);

  const worked = db
    .prepare(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL AND clock_out_at > clock_in_at
               THEN MIN(clock_out_at, ?) - MAX(clock_in_at, ?)
             WHEN clock_in_at IS NOT NULL AND status = 'ACTIVE'
               THEN ? - MAX(clock_in_at, ?)
             ELSE 0
           END
         ), 0) as worked_ms
       FROM day_sessions
       WHERE user_id IN (${ph})
         AND (
           (clock_in_at IS NOT NULL AND clock_in_at <= ?) OR status = 'ACTIVE'
         )
         AND (clock_out_at IS NULL OR clock_out_at >= ?)`,
    )
    .get(endMs, startMs, endMs, startMs, ...techIds, endMs, startMs);

  const breaks = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN break_type = 'LUNCH' THEN
           (COALESCE(MIN(ended_at, ?), ?) - MAX(started_at, ?)) ELSE 0 END), 0) as lunch_ms,
         COALESCE(SUM(CASE WHEN break_type = 'PERSONAL' THEN
           (COALESCE(MIN(ended_at, ?), ?) - MAX(started_at, ?)) ELSE 0 END), 0) as personal_ms
       FROM break_segments
       WHERE user_id IN (${ph})
         AND started_at <= ?
         AND (ended_at IS NULL OR ended_at >= ?)`,
    )
    .get(endMs, endMs, startMs, endMs, endMs, startMs, ...techIds, endMs, startMs);

  const workedMs = Math.max(0, worked.worked_ms || 0);
  const lunchMs = Math.max(0, breaks.lunch_ms || 0);
  const personalMs = Math.max(0, breaks.personal_ms || 0);
  const productiveMs = Math.max(0, workedMs - lunchMs - personalMs);
  const productiveHours = productiveMs / 3600000;
  const locatesClosed = production.locates_closed || 0;
  const footage = production.footage || 0;

  return {
    ticketsOnBoard: tickets.on_board || 0,
    ticketsClosedInRange: tickets.closed_in_range || 0,
    ticketsTotalClosed: tickets.total_closed || 0,
    locatesClosed,
    footage,
    utilityMinutes: production.utility_minutes || 0,
    workedMs,
    lunchMs,
    personalMs,
    productiveMs,
    lph: productiveHours > 0 ? locatesClosed / productiveHours : 0,
    fph: productiveHours > 0 ? footage / productiveHours : 0,
  };
}

function mapTicketRow(ticket) {
  const tech = ticket.assigned_tech_id
    ? db
        .prepare(
          "SELECT id, name, area_id FROM users WHERE id = ?",
        )
        .get(ticket.assigned_tech_id)
    : null;

  // Count reschedules for this ticket
  const rescheduleCount = db
    .prepare("SELECT COUNT(*) as c FROM ticket_reschedules WHERE ticket_id = ?")
    .get(ticket.id)?.c || 0;

  return {
    id: ticket.id,
    ticketNumber: ticket.ticket_number,
    ticketType: ticket.ticket_type,
    status: ticket.status,
    locatorStatus: ticket.locator_status,
    address: ticket.address,
    lat: ticket.lat,
    lng: ticket.lng,
    assignedTechId: ticket.assigned_tech_id,
    assignedTech: tech
      ? { id: tech.id, name: tech.name, areaId: tech.area_id }
      : null,
    areaId: tech ? tech.area_id : null,
    dueAt: ticket.due_at,
    originalDueAt: ticket.original_due_at ?? ticket.due_at,
    rescheduleCount,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    closedAt: ticket.closed_at,
    version: ticket.version,
    source: ticket.source,
    externalTicketId: ticket.external_ticket_id,
    priority: ticket.priority || "NORMAL",
    payloadJson: ticket.payload_json,
    // Lineage fields (linked-ticket model).
    rootTicketId: ticket.root_ticket_id,
    parentTicketId: ticket.parent_ticket_id,
    sequenceNumber: ticket.sequence_number,
    externalRootNumber: ticket.external_root_number,
  };
}

// ---------- auth ----------

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access token required" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
}

function authenticateTokenQuery(req, res, next) {
  // SSE clients can't set Authorization headers; accept ?token= as fallback
  const authHeader = req.headers["authorization"];
  const headerToken = authHeader && authHeader.split(" ")[1];
  const token = headerToken || req.query.token;
  if (!token) return res.status(401).json({ error: "Access token required" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
}

// Ops login now delegates to the shared auth logic (see routes/auth.js).
// Kept as a thin wrapper for backward compatibility with L720Ops.
router.post("/auth/login", async (req, res) => {
  const { authenticateLogin } = await import("../routes/auth.js");
  // Not ideal to dynamically import, so we forward to the unified endpoint.
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  const user = db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(email);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  let passwordValid = false;
  if (process.env.DEV_MODE === "true" && user.password_hash === '$2b$10$YourDevHashHere.ShouldBeReplacedInProd') {
    passwordValid = true;
  } else if (user.password_hash) {
    passwordValid = await bcrypt.compare(password, user.password_hash);
  }
  if (!passwordValid) return res.status(401).json({ error: "Invalid credentials" });

  // Only supervisors and above can access the ops portal.
  const OPS_ALLOWED_ROLES = ["SUPERVISOR", "AREA_MANAGER", "DISTRICT_MANAGER", "MANAGER"];
  if (!OPS_ALLOWED_ROLES.includes(user.role)) {
    return res.status(403).json({ error: "Technicians do not have access to the Ops Portal" });
  }

  if (user.password_must_change === 1) {
    return res.status(403).json({
      error: "Password change required",
      code: "PASSWORD_MUST_CHANGE",
      tempToken: jwt.sign({ id: user.id, mustChange: true }, JWT_SECRET, { expiresIn: "15m" }),
    });
  }

  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now(), user.id);

  const tokenPayload = { id: user.id, email: user.email, role: user.role, areaId: user.area_id, supervisorId: user.supervisor_id };
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "24h" });
  console.log(`[OPS Auth] User ${user.email} (${user.role}) logged in`);

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, areaId: user.area_id, supervisorId: user.supervisor_id, title: user.title, phone: user.phone },
  });
});

router.post("/auth/refresh", authenticateToken, (req, res) => {
  // Strip JWT reserved claims (iat, exp, nbf) before re-signing — jsonwebtoken
  // refuses to set expiresIn if the payload already carries an exp.
  const { iat, exp, nbf, ...rest } = req.user || {};
  void iat; void exp; void nbf;
  const token = jwt.sign(rest, JWT_SECRET, { expiresIn: "24h" });
  res.json({ token, user: { id: rest.id, email: rest.email, role: rest.role } });
});

router.patch("/auth/password", authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Verify current password (skip for temp token change)
  if (currentPassword && user.password_hash !== '$2b$10$YourDevHashHere.ShouldBeReplacedInProd') {
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, password_must_change = 0 WHERE id = ?")
    .run(newHash, userId);

  console.log(`[OPS Auth] Password changed for user ${user.email}`);
  res.json({ message: "Password updated successfully" });
});

router.delete("/auth/logout", authenticateToken, (req, res) => {
  console.log(`[OPS Auth] User ${req.user.username} logged out`);
  res.json({ message: "Logged out successfully" });
});

// ---------- SSE stream ----------

router.get("/events", authenticateTokenQuery, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // initial hello so clients know the stream is live
  send({ type: "hello", payload: { at: Date.now() }, at: Date.now() });

  const unsubscribe = subscribeOpsEvents(send);
  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ---------- dashboard ----------

router.get("/dashboard/stats", authenticateToken, (req, res) => {
  try {
    const { startMs, endMs, rangeKey, label } = resolveRange(req);

    const techs = db
      .prepare("SELECT id FROM users WHERE role IN ('TRAINEE','TRAINER','TECH') AND is_active = 1")
      .all();

    let clockedIn = 0;
    let onLunch = 0;
    let onPersonal = 0;
    for (const t of techs) {
      const state = getLiveClockState(t.id);
      if (state.clockStatus === "CLOCKED_IN") clockedIn += 1;
      else if (state.clockStatus === "ON_LUNCH") onLunch += 1;
      else if (state.clockStatus === "ON_PERSONAL") onPersonal += 1;
    }

    const ticketsByStatus = db
      .prepare(
        `SELECT
           SUM(CASE WHEN locator_status = 'ASSIGNED' THEN 1 ELSE 0 END) as assigned,
           SUM(CASE WHEN locator_status = 'ENROUTE' THEN 1 ELSE 0 END) as enroute,
           SUM(CASE WHEN locator_status = 'ONSITE' THEN 1 ELSE 0 END) as onsite,
           SUM(CASE WHEN locator_status = 'PAUSED' THEN 1 ELSE 0 END) as paused,
           SUM(CASE WHEN locator_status = 'CLOSED' THEN 1 ELSE 0 END) as closed,
           SUM(CASE WHEN locator_status = 'UNABLE' THEN 1 ELSE 0 END) as unable,
           SUM(CASE WHEN assigned_tech_id IS NULL AND locator_status NOT IN ('CLOSED','UNABLE') THEN 1 ELSE 0 END) as unassigned,
           COUNT(*) as total
         FROM tickets`,
      )
      .get();

    const inRange = db
      .prepare(
        `SELECT
           SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN 1 ELSE 0 END) as created,
           SUM(CASE WHEN closed_at IS NOT NULL AND closed_at >= ? AND closed_at <= ? THEN 1 ELSE 0 END) as closed
         FROM tickets`,
      )
      .get(startMs, endMs, startMs, endMs);

    const productionRange = db
      .prepare(
        `SELECT
           COALESCE(SUM(footage_delta), 0) as footage,
           COALESCE(SUM(completed_delta), 0) as locates_closed,
           COALESCE(SUM(minutes_delta), 0) as utility_minutes
         FROM utility_production_ledger
         WHERE occurred_at >= ? AND occurred_at <= ?`,
      )
      .get(startMs, endMs);

    const areas = db
      .prepare(
        `SELECT
           u.area_id as areaId,
           COUNT(DISTINCT u.id) as techs,
           SUM(CASE WHEN t.locator_status NOT IN ('CLOSED','UNABLE') AND t.id IS NOT NULL THEN 1 ELSE 0 END) as openTickets,
           SUM(CASE WHEN t.closed_at IS NOT NULL AND t.closed_at >= ? AND t.closed_at <= ? THEN 1 ELSE 0 END) as closedInRange
         FROM users u
         LEFT JOIN tickets t ON t.assigned_tech_id = u.id
         WHERE u.role IN ('TRAINEE','TRAINER','TECH') AND u.is_active = 1 AND u.area_id IS NOT NULL
         GROUP BY u.area_id
         ORDER BY u.area_id`,
      )
      .all(startMs, endMs);

    const productiveHours = (() => {
      // Org-wide productive hours = sum of worked - lunch - personal in range
      const w = db
        .prepare(
          `SELECT COALESCE(SUM(
             CASE
               WHEN clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL AND clock_out_at > clock_in_at
                 THEN MIN(clock_out_at, ?) - MAX(clock_in_at, ?)
               WHEN clock_in_at IS NOT NULL AND status = 'ACTIVE'
                 THEN ? - MAX(clock_in_at, ?)
               ELSE 0
             END
           ), 0) as worked_ms
           FROM day_sessions
           WHERE (clock_in_at IS NOT NULL AND clock_in_at <= ?)
             AND (clock_out_at IS NULL OR clock_out_at >= ?)`,
        )
        .get(endMs, startMs, endMs, startMs, endMs, startMs);
      const b = db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(MIN(ended_at, ?), ?) - MAX(started_at, ?)), 0) as break_ms
           FROM break_segments
           WHERE started_at <= ?
             AND (ended_at IS NULL OR ended_at >= ?)`,
        )
        .get(endMs, endMs, startMs, endMs, startMs);
      return Math.max(0, (w.worked_ms || 0) - (b.break_ms || 0)) / 3600000;
    })();

    const avgLph =
      productiveHours > 0 ? (productionRange.locates_closed || 0) / productiveHours : 0;
    const avgFph =
      productiveHours > 0 ? (productionRange.footage || 0) / productiveHours : 0;

    res.json({
      range: { startMs, endMs, rangeKey, label },
      techs: {
        total: techs.length,
        clockedIn,
        onLunch,
        onPersonal,
        clockedOut: techs.length - clockedIn - onLunch - onPersonal,
      },
      tickets: {
        total: ticketsByStatus.total || 0,
        byLocatorStatus: {
          ASSIGNED: ticketsByStatus.assigned || 0,
          ENROUTE: ticketsByStatus.enroute || 0,
          ONSITE: ticketsByStatus.onsite || 0,
          PAUSED: ticketsByStatus.paused || 0,
          CLOSED: ticketsByStatus.closed || 0,
          UNABLE: ticketsByStatus.unable || 0,
        },
        unassigned: ticketsByStatus.unassigned || 0,
        createdInRange: inRange.created || 0,
        closedInRange: inRange.closed || 0,
      },
      production: {
        footageInRange: productionRange.footage || 0,
        locatesClosedInRange: productionRange.locates_closed || 0,
        utilityMinutesInRange: productionRange.utility_minutes || 0,
        avgLph,
        avgFph,
      },
      areas,
    });
  } catch (error) {
    console.error("[OPS Dashboard] Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});

router.get("/dashboard/tech-status", authenticateToken, (req, res) => {
  try {
    const techs = db
      .prepare(
        "SELECT id, name, email, area_id FROM users WHERE role IN ('TRAINEE','TRAINER','TECH') AND is_active = 1 ORDER BY name ASC",
      )
      .all();

    const out = techs.map((tech) => {
      const clock = getLiveClockState(tech.id);
      const currentTicket = getTechCurrentTicket(tech.id);
      const assignedTerritories = getTechAssignedTerritories(tech.id);
      const activeTickets = db
        .prepare(
          `SELECT COUNT(*) as c FROM tickets
           WHERE assigned_tech_id = ? AND locator_status NOT IN ('CLOSED','UNABLE')`,
        )
        .get(tech.id).c;

      return {
        id: tech.id,
        name: tech.name,
        email: tech.email,
        areaId: tech.area_id,
        clockStatus: clock.clockStatus,
        currentSession: clock.currentSession,
        currentTicket,
        assignedTerritories,
        activeTickets,
      };
    });

    res.json(out);
  } catch (error) {
    console.error("[OPS Dashboard] Error fetching tech status:", error);
    res.status(500).json({ error: "Failed to fetch tech status" });
  }
});

router.get("/dashboard/activity", authenticateToken, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const events = db
      .prepare(
        `SELECT te.*, t.ticket_number, u.name as user_name
         FROM ticket_events te
         LEFT JOIN tickets t ON t.id = te.ticket_id
         LEFT JOIN users u ON u.id = te.user_id
         ORDER BY te.created_at DESC
         LIMIT ?`,
      )
      .all(limit);

    res.json(
      events.map((e) => ({
        id: e.id,
        ticketId: e.ticket_id,
        ticketNumber: e.ticket_number,
        type: e.event_type,
        oldStatus: e.old_status,
        newStatus: e.new_status,
        oldLocatorStatus: e.old_locator_status,
        newLocatorStatus: e.new_locator_status,
        userId: e.user_id,
        userName: e.user_name,
        notes: e.notes,
        createdAt: e.created_at,
      })),
    );
  } catch (error) {
    console.error("[OPS Dashboard] Error fetching activity:", error);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

// ---------- techs ----------

router.get("/techs", authenticateToken, (req, res) => {
  try {
    const { area, status, search } = req.query;
    const range = resolveRange(req);

    let query = "SELECT id, name, email, role, area_id, supervisor_id, created_at FROM users WHERE role IN ('TRAINEE', 'TRAINER', 'TECH', 'SUPERVISOR', 'AREA_MANAGER', 'DISTRICT_MANAGER') AND is_active = 1";
    const params = [];

    if (area) {
      query += " AND area_id = ?";
      params.push(area);
    }

    if (search) {
      query += " AND (name LIKE ? OR email LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s);
    }

    query += " ORDER BY name ASC";

    const techs = db.prepare(query).all(...params);

    const rows = techs
      .map((tech) => {
        const clock = getLiveClockState(tech.id);
        if (status && clock.clockStatus !== status) return null;
        const prod = computeUserProductivity(tech.id, tech.role, range.startMs, range.endMs);
        const currentTicket = getTechCurrentTicket(tech.id);
        const assignedTerritories = getTechAssignedTerritories(tech.id);
        return {
          id: tech.id,
          name: tech.name,
          email: tech.email,
          role: tech.role,
          areaId: tech.area_id,
          supervisorId: tech.supervisor_id,
          createdAt: tech.created_at,
          clockStatus: clock.clockStatus,
          currentSession: clock.currentSession,
          currentTicket,
          assignedTerritories,
          ...prod,
        };
      })
      .filter(Boolean);

    res.json({
      range: {
        startMs: range.startMs,
        endMs: range.endMs,
        rangeKey: range.rangeKey,
        label: range.label,
      },
      techs: rows,
    });
  } catch (error) {
    console.error("[OPS Techs] Error fetching techs:", error);
    res.status(500).json({ error: "Failed to fetch technicians" });
  }
});

router.get("/techs/:id", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const tech = db
      .prepare(
        `SELECT u.*, s.name as supervisor_name
         FROM users u LEFT JOIN users s ON s.id = u.supervisor_id
         WHERE u.id = ? AND u.role IN ('TRAINEE', 'TRAINER', 'TECH', 'SUPERVISOR', 'AREA_MANAGER', 'DISTRICT_MANAGER')`,
      )
      .get(id);
    if (!tech) return res.status(404).json({ error: "User not found" });

    const range = resolveRange(req);
    const clock = getLiveClockState(id);
    const currentTicket = getTechCurrentTicket(id);
    const assignedTerritories = getTechAssignedTerritories(id);
    const productivity = computeUserProductivity(tech.id, tech.role, range.startMs, range.endMs);

    res.json({
      id: tech.id,
      name: tech.name,
      email: tech.email,
      role: tech.role,
      areaId: tech.area_id,
      supervisorId: tech.supervisor_id,
      supervisorName: tech.supervisor_name,
      createdAt: tech.created_at,
      clockStatus: clock.clockStatus,
      currentSession: clock.currentSession,
      currentTicket,
      assignedTerritories,
      range: {
        startMs: range.startMs,
        endMs: range.endMs,
        rangeKey: range.rangeKey,
        label: range.label,
      },
      productivity,
    });
  } catch (error) {
    console.error("[OPS Techs] Error fetching tech detail:", error);
    res.status(500).json({ error: "Failed to fetch technician detail" });
  }
});

router.get("/techs/:id/tickets", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { status, locatorStatus } = req.query;
    const range = resolveRange(req);

    // Look up the user to determine their role and territory scope.
    // Hierarchy: a supervisor sees all tickets in their supervisor territory,
    // an area manager sees all tickets in their area, a district manager sees
    // all tickets in their district, and a tech sees tickets in their tech
    // territories (plus any directly assigned to them).
    const user = db.prepare("SELECT id, role FROM users WHERE id = ?").get(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const dir = getUserDirectTerritories(db, id);
    let whereSql;
    let params;

    if (user.role === "MANAGER") {
      whereSql = "1=1";
      params = [];
    } else if (user.role === "DISTRICT_MANAGER" && dir.DISTRICT.length) {
      const ph = dir.DISTRICT.map(() => "?").join(",");
      whereSql = `tickets.district_territory_id IN (${ph})`;
      params = [...dir.DISTRICT];
    } else if (user.role === "AREA_MANAGER" && dir.AREA.length) {
      const ph = dir.AREA.map(() => "?").join(",");
      whereSql = `tickets.area_territory_id IN (${ph})`;
      params = [...dir.AREA];
    } else if (user.role === "SUPERVISOR" && dir.SUPERVISOR_TERRITORY.length) {
      const ph = dir.SUPERVISOR_TERRITORY.map(() => "?").join(",");
      whereSql = `tickets.supervisor_territory_id IN (${ph})`;
      params = [...dir.SUPERVISOR_TERRITORY];
    } else if (dir.TECH_TERRITORY.length) {
      const ph = dir.TECH_TERRITORY.map(() => "?").join(",");
      whereSql = `(tickets.tech_territory_id IN (${ph}) OR tickets.assigned_tech_id = ?)`;
      params = [...dir.TECH_TERRITORY, id];
    } else {
      // Fallback: only tickets directly assigned to this user.
      whereSql = "tickets.assigned_tech_id = ?";
      params = [id];
    }

    let query = `SELECT * FROM tickets WHERE (${whereSql}) AND (updated_at >= ? OR locator_status NOT IN ('CLOSED','UNABLE'))`;
    params.push(range.startMs);

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    if (locatorStatus) {
      query += " AND locator_status = ?";
      params.push(locatorStatus);
    }

    query += " ORDER BY updated_at DESC";

    const tickets = db.prepare(query).all(...params);
    res.json({
      tickets: tickets.map((t) => ({
        ...mapTicketRow(t),
        timeAllocation: computeTicketTimeAllocation(t),
      })),
    });
  } catch (error) {
    console.error("[OPS Techs] Error fetching tech tickets:", error);
    res.status(500).json({ error: "Failed to fetch tech tickets" });
  }
});

router.get("/techs/:id/timesheet", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const range = resolveRange(req);

    const sessions = db
      .prepare(
        `SELECT * FROM day_sessions
         WHERE user_id = ?
           AND (clock_in_at >= ? OR status = 'ACTIVE')
           AND (clock_out_at IS NULL OR clock_out_at <= ?)
         ORDER BY clock_in_at DESC`,
      )
      .all(id, range.startMs, range.endMs);

    const hydrated = sessions.map((s) => {
      const breaks = db
        .prepare(
          `SELECT * FROM break_segments WHERE session_id = ? ORDER BY started_at ASC`,
        )
        .all(s.id);
      const allocSegs = db
        .prepare(
          `SELECT * FROM allocation_segments WHERE session_id = ? ORDER BY started_at ASC`,
        )
        .all(s.id);
      const now = Date.now();
      const workedMs =
        s.clock_in_at && s.clock_out_at
          ? Math.max(0, s.clock_out_at - s.clock_in_at)
          : s.clock_in_at
          ? Math.max(0, now - s.clock_in_at)
          : 0;
      let lunchMs = 0;
      let personalMs = 0;
      for (const b of breaks) {
        const end = b.ended_at ?? now;
        const dur = Math.max(0, end - b.started_at);
        if (b.break_type === "LUNCH") lunchMs += dur;
        else if (b.break_type === "PERSONAL") personalMs += dur;
      }
      // Per-allocation time breakdown
      const allocationBreakdown = {};
      for (const seg of allocSegs) {
        const end = seg.ended_at ?? now;
        const dur = Math.max(0, end - seg.started_at);
        if (!allocationBreakdown[seg.allocation_type]) {
          allocationBreakdown[seg.allocation_type] = {
            type: seg.allocation_type,
            ms: 0,
            segments: [],
          };
        }
        allocationBreakdown[seg.allocation_type].ms += dur;
        allocationBreakdown[seg.allocation_type].segments.push({
          id: seg.id,
          startedAt: seg.started_at,
          endedAt: seg.ended_at,
          otherReason: seg.other_reason,
        });
      }
      return {
        id: s.id,
        date: s.date,
        clockInAt: s.clock_in_at,
        clockOutAt: s.clock_out_at,
        status: s.status,
        clockInReason: s.clock_in_reason || null,
        allocationType: s.allocation_type || null,
        otherReason: s.other_reason || null,
        workedMs,
        lunchMs,
        personalMs,
        productiveMs: Math.max(0, workedMs - lunchMs - personalMs),
        breakSegments: breaks.map((b) => ({
          id: b.id,
          type: b.break_type,
          startedAt: b.started_at,
          endedAt: b.ended_at,
          reason: b.reason,
        })),
        allocationSegments: allocSegs.map((seg) => ({
          id: seg.id,
          allocationType: seg.allocation_type,
          otherReason: seg.other_reason,
          startedAt: seg.started_at,
          endedAt: seg.ended_at,
        })),
        allocationBreakdown: Object.values(allocationBreakdown).sort(
          (a, b) => b.ms - a.ms,
        ),
      };
    });

    const totals = hydrated.reduce(
      (acc, s) => {
        acc.workedMs += s.workedMs;
        acc.lunchMs += s.lunchMs;
        acc.personalMs += s.personalMs;
        acc.productiveMs += s.productiveMs;
        // Aggregate allocation breakdown across all sessions
        for (const alloc of s.allocationBreakdown) {
          if (!acc.allocationBreakdown[alloc.type]) {
            acc.allocationBreakdown[alloc.type] = { type: alloc.type, ms: 0 };
          }
          acc.allocationBreakdown[alloc.type].ms += alloc.ms;
        }
        return acc;
      },
      { workedMs: 0, lunchMs: 0, personalMs: 0, productiveMs: 0, allocationBreakdown: {} },
    );

    res.json({
      range: {
        startMs: range.startMs,
        endMs: range.endMs,
        rangeKey: range.rangeKey,
        label: range.label,
      },
      sessions: hydrated,
      totals: {
        workedMs: totals.workedMs,
        lunchMs: totals.lunchMs,
        personalMs: totals.personalMs,
        productiveMs: totals.productiveMs,
        allocationBreakdown: Object.values(totals.allocationBreakdown).sort(
          (a, b) => b.ms - a.ms,
        ),
      },
    });
  } catch (error) {
    console.error("[OPS Techs] Error fetching timesheet:", error);
    res.status(500).json({ error: "Failed to fetch timesheet" });
  }
});

router.put("/techs/:id", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { areaId, supervisorId } = req.body;
    const tech = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!tech) return res.status(404).json({ error: "User not found" });

    const updates = [];
    const params = [];
    if (areaId !== undefined) {
      updates.push("area_id = ?");
      params.push(areaId);
    }
    if (supervisorId !== undefined) {
      updates.push("supervisor_id = ?");
      params.push(supervisorId);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    updates.push("updated_at = ?");
    params.push(Date.now(), id);
    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    emitOpsEvent("tech.updated", { userId: id, by: req.user?.id });
    res.json({ ok: true, userId: id });
  } catch (error) {
    console.error("[OPS Techs] Error updating tech:", error);
    res.status(500).json({ error: "Failed to update technician" });
  }
});

/**
 * GET /api/ops/techs-locations
 * Returns live/latest locations for all techs visible to the authenticated user.
 * Role-based filtering:
 *   - SUPERVISOR: sees techs in their supervisor territories
 *   - AREA_MANAGER: sees techs under all supervisors in their areas
 *   - DISTRICT_MANAGER / MANAGER: sees all techs
 */
router.get("/techs-locations", authenticateToken, (req, res) => {
  try {
    const viewerId = req.user?.id;
    const viewerRole = req.user?.role;

    if (!viewerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get list of tech IDs accessible to this viewer
    const accessibleTechIds = getTechIdsUnderUser(db, viewerId, viewerRole);
    if (accessibleTechIds.length === 0) {
      return res.json({ techs: [] });
    }

    const placeholders = accessibleTechIds.map(() => "?").join(",");

    // Query active sessions and latest recorded location for each accessible tech
    const rows = db.prepare(`
      SELECT 
        u.id as user_id,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role,
        ds.id as active_session_id,
        ds.clock_in_at,
        ds.allocation_type,
        tl.latitude,
        tl.longitude,
        tl.accuracy,
        tl.heading,
        tl.speed,
        tl.recorded_at
      FROM users u
      JOIN day_sessions ds ON ds.user_id = u.id AND ds.status = 'ACTIVE'
      LEFT JOIN (
        SELECT tl1.*
        FROM tech_locations tl1
        JOIN (
          SELECT user_id, MAX(recorded_at) as max_recorded
          FROM tech_locations
          GROUP BY user_id
        ) tl2 ON tl1.user_id = tl2.user_id AND tl1.recorded_at = tl2.max_recorded
      ) tl ON tl.user_id = u.id
      WHERE u.id IN (${placeholders})
        AND u.is_active = 1
    `).all(...accessibleTechIds);

    const techs = rows
      .filter((r) => r.latitude !== null && r.longitude !== null)
      .map((r) => ({
        userId: r.user_id,
        name: r.user_name,
        email: r.user_email,
        role: r.user_role,
        clockInAt: r.clock_in_at,
        allocationType: r.allocation_type,
        latitude: r.latitude,
        longitude: r.longitude,
        accuracy: r.accuracy,
        heading: r.heading,
        speed: r.speed,
        recordedAt: r.recorded_at,
      }));

    res.json({ techs });
  } catch (error) {
    console.error("[OPS Techs] Error fetching techs locations:", error);
    res.status(500).json({ error: "Failed to fetch tech locations" });
  }
});

/**
 * GET /api/ops/techs/:id/route
 * Returns the breadcrumb trail/route for a specific tech (only during active/completed clocked-in sessions).
 */
router.get("/techs/:id/route", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { since, sessionId } = req.query;

    let query = `
      SELECT id, user_id, session_id, latitude, longitude, accuracy, heading, speed, recorded_at
      FROM tech_locations
      WHERE user_id = ?
    `;
    const params = [id];

    if (sessionId) {
      query += ` AND session_id = ?`;
      params.push(sessionId);
    } else if (since) {
      query += ` AND recorded_at >= ?`;
      params.push(parseInt(since, 10) || 0);
    } else {
      // Default to last 24 hours
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      query += ` AND recorded_at >= ?`;
      params.push(dayAgo);
    }

    query += ` ORDER BY recorded_at ASC`;

    const points = db.prepare(query).all(...params);
    res.json({ points });
  } catch (error) {
    console.error("[OPS Techs] Error fetching tech route:", error);
    res.status(500).json({ error: "Failed to fetch tech route" });
  }
});

// ---------- tickets ----------

router.get("/tickets", authenticateToken, (req, res) => {
  try {
    const {
      status,
      locatorStatus,
      areaId,
      assignedTechId,
      unassigned,
      source,
      ticketType,
      search,
      createdAfter,
      createdBefore,
      closedAfter,
      closedBefore,
      sortBy = "updated_at",
      sortDir = "desc",
      page = 1,
      limit = 50,
    } = req.query;

    let query = "SELECT * FROM tickets WHERE 1=1";
    const params = [];

    // Territory-based visibility: non-MANAGER users only see tickets in their territory.
    const territoryFilter = buildTicketVisibilityFilter(db, req.user);
    query += ` AND ${territoryFilter.sql}`;
    params.push(...territoryFilter.params);

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    if (locatorStatus) {
      query += " AND locator_status = ?";
      params.push(locatorStatus);
    }
    if (areaId) {
      query += " AND assigned_tech_id IN (SELECT id FROM users WHERE area_id = ?)";
      params.push(areaId);
    }
    if (req.query.territoryId) {
      // Filter by any territory level. A ticket matches if its
      // tech/supervisor/area/district territory ID equals the given ID.
      query += " AND (tech_territory_id = ? OR supervisor_territory_id = ? OR area_territory_id = ? OR district_territory_id = ?)";
      const tid = req.query.territoryId;
      params.push(tid, tid, tid, tid);
    }
    if (assignedTechId) {
      query += " AND assigned_tech_id = ?";
      params.push(assignedTechId);
    }
    if (unassigned === "true" || unassigned === true) {
      query += " AND assigned_tech_id IS NULL";
    }
    if (source) {
      query += " AND source = ?";
      params.push(source);
    }
    if (ticketType) {
      query += " AND ticket_type = ?";
      params.push(ticketType);
    }
    if (search) {
      query += " AND (ticket_number LIKE ? OR address LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s);
    }
    if (createdAfter) {
      query += " AND created_at >= ?";
      params.push(Number(createdAfter));
    }
    if (createdBefore) {
      query += " AND created_at <= ?";
      params.push(Number(createdBefore));
    }
    if (closedAfter) {
      query += " AND closed_at >= ?";
      params.push(Number(closedAfter));
    }
    if (closedBefore) {
      query += " AND closed_at <= ?";
      params.push(Number(closedBefore));
    }

    const validSort = new Set([
      "updated_at",
      "created_at",
      "due_at",
      "closed_at",
      "ticket_number",
    ]);
    const sortCol = validSort.has(sortBy) ? sortBy : "updated_at";
    const dir = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

    const countQuery = query.replace("SELECT *", "SELECT COUNT(*) as c");
    const total = db.prepare(countQuery).get(...params).c;

    query += ` ORDER BY ${sortCol} ${dir}`;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += " LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const tickets = db.prepare(query).all(...params);

    res.json({
      tickets: tickets.map(mapTicketRow),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("[OPS Tickets] Error fetching tickets:", error);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

router.get("/tickets/:id", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (!canUserSeeTicket(db, req.user, ticket)) {
      return res.status(403).json({ error: "Access denied — ticket outside your territory" });
    }

    const tech = ticket.assigned_tech_id
      ? db
          .prepare(
            "SELECT id, name, email, area_id FROM users WHERE id = ?",
          )
          .get(ticket.assigned_tech_id)
      : null;

    const events = db
      .prepare(
        "SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY created_at ASC",
      )
      .all(id);

    const notes = db
      .prepare(
        "SELECT id, author_id, author_name, body, note_type, created_at FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at DESC",
      )
      .all(id);

    const attachments = db
      .prepare(
        `SELECT id, uploader_id, uploader_name, kind, file_name, mime_type,
                width, height, file_size, lat, lng, captured_at, created_at
         FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at DESC`,
      )
      .all(id);

    const productionLedger = db
      .prepare(
        `SELECT * FROM utility_production_ledger WHERE ticket_id = ? ORDER BY occurred_at ASC`,
      )
      .all(id);

    const payload = parseJson(ticket.payload_json);
    const customerLookup = new Map(
      (payload.customers || []).map((c) => [c.id, c]),
    );
    const markings = payload.customerMarkings || payload.customerMarking || {};
    const customers = Object.entries(markings).map(([customerId, m]) => {
      const c = customerLookup.get(customerId) || {};
      return {
        customerId,
        customerName: c.name || null,
        utilityType: c.utility || null,
        status: m?.status || "",
        result: m?.result || "",
        minutes: m?.minutes || "0",
        footage: m?.footage || "0",
        completed: m?.completed === true,
        notes: m?.notes || "",
      };
    });

    res.json({
      ...mapTicketRow(ticket),
      assignedTech: tech
        ? { id: tech.id, name: tech.name, email: tech.email, areaId: tech.area_id }
        : null,
      timeAllocation: computeTicketTimeAllocation(ticket),
      customers,
      productionLedger: productionLedger.map((p) => ({
        id: p.id,
        userId: p.user_id,
        customerId: p.customer_id,
        customerName: p.customer_name,
        utilityType: p.utility_type,
        minutesDelta: p.minutes_delta,
        footageDelta: p.footage_delta,
        completedDelta: p.completed_delta,
        sourceEventType: p.source_event_type,
        occurredAt: p.occurred_at,
      })),
      notes,
      attachments,
      events: events.map((e) => ({
        id: e.id,
        type: e.event_type,
        oldStatus: e.old_status,
        newStatus: e.new_status,
        oldLocatorStatus: e.old_locator_status,
        newLocatorStatus: e.new_locator_status,
        userId: e.user_id,
        notes: e.notes,
        payload: parseJson(e.payload_json),
        createdAt: e.created_at,
      })),
    });
  } catch (error) {
    console.error("[OPS Tickets] Error fetching ticket detail:", error);
    res.status(500).json({ error: "Failed to fetch ticket detail" });
  }
});

/**
 * GET /api/ops/tickets/:id/chain
 * Return the full ordered ticket chain with per-ticket operational summary
 * (minutes, footage, assigned tech). IMPORTANT: numbers are per-ticket and
 * never rolled up across the chain \u2014 each ticket is still an independent
 * billable work item.
 */
router.get("/tickets/:id/chain", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const anchor = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
    if (!anchor) return res.status(404).json({ error: "Ticket not found" });
    if (!canUserSeeTicket(db, req.user, anchor)) {
      return res.status(403).json({ error: "Access denied — ticket outside your territory" });
    }
    res.json({ chain: getChainWithSummaries(db, id) });
  } catch (error) {
    console.error("[OPS Tickets] Error fetching ticket chain:", error);
    res.status(500).json({ error: "Failed to fetch ticket chain" });
  }
});

// Ops JWTs carry synthetic ids like `ops-admin` that don't exist in `users`.
// `ticket_events.user_id` has a FK to `users(id)` so we must coerce unknown
// actors to NULL or the INSERT (and the enclosing transaction) explodes.
function resolveActorUserId(actorUserId) {
  if (!actorUserId) return null;
  const hit = db
    .prepare("SELECT id FROM users WHERE id = ?")
    .get(actorUserId);
  return hit ? hit.id : null;
}

function assignTicketInternal(ticketId, techId, actorUserId) {
  const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
  if (!ticket) return { ok: false, error: "Ticket not found" };

  // Terminal tickets can't be reassigned — the ticket is done, and the new
  // tech's mobile filters out CLOSED/UNABLE so they'd never see it anyway.
  if (ticket.locator_status === "CLOSED" || ticket.locator_status === "UNABLE") {
    return {
      ok: false,
      error: `Cannot reassign a ${ticket.locator_status} ticket. Reopen it first.`,
    };
  }

  let resolvedTechId = techId;
  let tech = null;
  if (techId) {
    tech = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'TECH'").get(techId);
    if (!tech) return { ok: false, error: "Technician not found" };
  } else {
    resolvedTechId = null;
  }

  const now = Date.now();
  db.prepare(
    `UPDATE tickets
     SET assigned_tech_id = ?,
         locator_status = CASE WHEN locator_status = 'PENDING' THEN 'ASSIGNED' ELSE locator_status END,
         updated_at = ?,
         version = version + 1
     WHERE id = ?`,
  ).run(resolvedTechId, now, ticketId);

  db.prepare(
    `INSERT INTO ticket_events (id, ticket_id, event_type, user_id, notes, payload_json, created_at)
     VALUES (?, ?, 'OPS_ASSIGN', ?, ?, ?, ?)`,
  ).run(
    uuidv4(),
    ticketId,
    resolveActorUserId(actorUserId),
    resolvedTechId ? `Assigned to ${tech.name}` : "Unassigned",
    JSON.stringify({
      previousTechId: ticket.assigned_tech_id,
      newTechId: resolvedTechId,
      actor: actorUserId || null,
    }),
    now,
  );

  emitOpsEvent("ticket.assigned", {
    ticketId,
    ticketNumber: ticket.ticket_number,
    previousTechId: ticket.assigned_tech_id,
    newTechId: resolvedTechId,
    by: actorUserId || null,
  });
  emitOpsEvent("ticket.updated", {
    ticketId,
    ticketNumber: ticket.ticket_number,
    status: ticket.status,
    locatorStatus: ticket.locator_status,
    assignedTechId: resolvedTechId,
  });

  // Notify the 811 simulator of the assignment so it can reflect real-world state
  if (resolvedTechId && tech && ticket.source === '811' && ticket.external_ticket_id) {
    fetch(
      `${process.env.SIMULATOR_URL || 'http://localhost:4100'}/api/811/tickets/${ticket.external_ticket_id}/assign`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ techId: resolvedTechId, techName: tech.name, locatorStatus: 'ASSIGNED' }),
      },
    ).catch((err) => console.error('[OPS] Failed to notify simulator of manual assignment:', err.message));
  }

  return { ok: true, tech };
}

router.put("/tickets/:id/assign", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (!canUserSeeTicket(db, req.user, ticket)) {
      return res.status(403).json({ error: "Access denied — ticket outside your territory" });
    }
    const { techId } = req.body;
    const result = assignTicketInternal(id, techId ?? null, req.user?.id);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({
      message: "Ticket assignment updated",
      ticketId: id,
      assignedTechId: techId ?? null,
      assignedTechName: result.tech?.name ?? null,
    });
  } catch (error) {
    console.error("[OPS Tickets] Error reassigning ticket:", error);
    res.status(500).json({ error: "Failed to reassign ticket" });
  }
});

router.post("/tickets/bulk-assign", authenticateToken, (req, res) => {
  try {
    const { ticketIds, techId } = req.body;
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({ error: "ticketIds required" });
    }
    // Pre-check territory visibility for all tickets.
    const denied = [];
    for (const tid of ticketIds) {
      const t = db.prepare("SELECT * FROM tickets WHERE id = ?").get(tid);
      if (!t) { denied.push({ ticketId: tid, ok: false, error: "Ticket not found" }); continue; }
      if (!canUserSeeTicket(db, req.user, t)) {
        denied.push({ ticketId: tid, ok: false, error: "Access denied — ticket outside your territory" });
      }
    }
    if (denied.length > 0) {
      return res.status(403).json({ error: "Some tickets are outside your territory", denied });
    }
    const results = [];
    const tx = db.transaction(() => {
      for (const tid of ticketIds) {
        const r = assignTicketInternal(tid, techId ?? null, req.user?.id);
        results.push({ ticketId: tid, ok: r.ok, error: r.error });
      }
    });
    tx();
    res.json({ results });
  } catch (error) {
    console.error("[OPS Tickets] Error in bulk assign:", error);
    res.status(500).json({ error: "Failed to bulk assign" });
  }
});

router.put("/tickets/:id/status", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { status, locatorStatus, notes } = req.body;
    if (!status && !locatorStatus) {
      return res.status(400).json({ error: "Status or locator status required" });
    }
    const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (!canUserSeeTicket(db, req.user, ticket)) {
      return res.status(403).json({ error: "Access denied — ticket outside your territory" });
    }

    // Enforce locator status machine. MANAGER can bypass for admin overrides.
    if (locatorStatus && req.user.role !== "MANAGER") {
      const valid = isValidLocatorTransition(ticket.locator_status, locatorStatus);
      if (!valid) {
        return res.status(400).json({
          error: `Invalid status transition: ${ticket.locator_status} → ${locatorStatus}`,
        });
      }
    }

    const updates = [];
    const params = [];
    if (status) {
      updates.push("status = ?");
      params.push(status);
    }
    if (locatorStatus) {
      updates.push("locator_status = ?");
      params.push(locatorStatus);
      if (locatorStatus === "CLOSED" || locatorStatus === "UNABLE") {
        updates.push("closed_at = ?");
        params.push(Date.now());
      }
      // Reopening: clear closed_at so ticket appears as active again.
      if ((ticket.locator_status === "CLOSED" || ticket.locator_status === "UNABLE") &&
          locatorStatus === "ASSIGNED") {
        updates.push("closed_at = NULL");
      }
    }
    updates.push("updated_at = ?");
    updates.push("version = version + 1");
    params.push(Date.now(), id);
    db.prepare(`UPDATE tickets SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    db.prepare(
      `INSERT INTO ticket_events (id, ticket_id, event_type, old_status, new_status, old_locator_status, new_locator_status, user_id, notes, created_at)
       VALUES (?, ?, 'OPS_STATUS', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uuidv4(),
      id,
      ticket.status,
      status ?? ticket.status,
      ticket.locator_status,
      locatorStatus ?? ticket.locator_status,
      resolveActorUserId(req.user?.id),
      notes || null,
      Date.now(),
    );

    emitOpsEvent("ticket.updated", {
      ticketId: id,
      ticketNumber: ticket.ticket_number,
      status: status ?? ticket.status,
      locatorStatus: locatorStatus ?? ticket.locator_status,
      assignedTechId: ticket.assigned_tech_id,
    });

    res.json({ message: "Ticket status updated", ticketId: id });
  } catch (error) {
    console.error("[OPS Tickets] Error updating ticket status:", error);
    res.status(500).json({ error: "Failed to update ticket status" });
  }
});

router.get("/tickets/export.csv", authenticateToken, (req, res) => {
  try {
    // Reuse the same filter logic by calling the tickets query inline
    req.query.limit = req.query.limit || "10000";
    req.query.page = "1";
    const {
      status,
      locatorStatus,
      areaId,
      assignedTechId,
      unassigned,
      source,
      ticketType,
      search,
    } = req.query;

    let query = "SELECT * FROM tickets WHERE 1=1";
    const params = [];

    // Territory-based visibility.
    const territoryFilter = buildTicketVisibilityFilter(db, req.user);
    query += ` AND ${territoryFilter.sql}`;
    params.push(...territoryFilter.params);

    if (status) { query += " AND status = ?"; params.push(status); }
    if (locatorStatus) { query += " AND locator_status = ?"; params.push(locatorStatus); }
    if (areaId) { query += " AND assigned_tech_id IN (SELECT id FROM users WHERE area_id = ?)"; params.push(areaId); }
    if (assignedTechId) { query += " AND assigned_tech_id = ?"; params.push(assignedTechId); }
    if (unassigned === "true") { query += " AND assigned_tech_id IS NULL"; }
    if (source) { query += " AND source = ?"; params.push(source); }
    if (ticketType) { query += " AND ticket_type = ?"; params.push(ticketType); }
    if (search) {
      query += " AND (ticket_number LIKE ? OR address LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s);
    }
    query += " ORDER BY updated_at DESC";

    const tickets = db.prepare(query).all(...params);

    const cols = [
      "ticketNumber",
      "ticketType",
      "status",
      "locatorStatus",
      "source",
      "address",
      "assignedTech",
      "areaId",
      "createdAt",
      "updatedAt",
      "closedAt",
    ];
    const header = cols.join(",");
    const rows = tickets.map((t) => {
      const tech = t.assigned_tech_id
        ? db.prepare("SELECT name, area_id FROM users WHERE id = ?").get(t.assigned_tech_id)
        : null;
      const esc = (v) => {
        if (v === null || v === undefined) return "";
        const str = String(v).replace(/"/g, '""');
        return /[,"\n]/.test(str) ? `"${str}"` : str;
      };
      return [
        esc(t.ticket_number),
        esc(t.ticket_type),
        esc(t.status),
        esc(t.locator_status),
        esc(t.source),
        esc(t.address),
        esc(tech?.name || ""),
        esc(tech?.area_id || ""),
        esc(t.created_at ? new Date(t.created_at).toISOString() : ""),
        esc(t.updated_at ? new Date(t.updated_at).toISOString() : ""),
        esc(t.closed_at ? new Date(t.closed_at).toISOString() : ""),
      ].join(",");
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tickets-${rangeToDateString(Date.now())}.csv"`,
    );
    res.send([header, ...rows].join("\n"));
  } catch (error) {
    console.error("[OPS Tickets] Error exporting:", error);
    res.status(500).json({ error: "Failed to export tickets" });
  }
});

// ---------- customers ----------

router.get("/customers/summary", authenticateToken, (req, res) => {
  try {
    const range = resolveRange(req);

    const rows = db
      .prepare(
        `SELECT
           customer_name as customerName,
           utility_type as utilityType,
           COALESCE(SUM(footage_delta), 0) as footage,
           COALESCE(SUM(minutes_delta), 0) as minutes,
           COALESCE(SUM(completed_delta), 0) as locatesClosed,
           COUNT(DISTINCT ticket_id) as ticketCount
         FROM utility_production_ledger
         WHERE occurred_at >= ? AND occurred_at <= ?
         GROUP BY customer_name, utility_type
         ORDER BY footage DESC`,
      )
      .all(range.startMs, range.endMs);

    res.json({
      range: {
        startMs: range.startMs,
        endMs: range.endMs,
        rangeKey: range.rangeKey,
        label: range.label,
      },
      customers: rows,
    });
  } catch (error) {
    console.error("[OPS Customers] Error fetching summary:", error);
    res.status(500).json({ error: "Failed to fetch customer summary" });
  }
});

// ---------- user management (admin) ----------

function requireRole(minRole) {
  const hierarchy = ['TRAINEE', 'TRAINER', 'TECH', 'SUPERVISOR', 'AREA_MANAGER', 'DISTRICT_MANAGER', 'MANAGER'];
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole) return res.status(401).json({ error: 'Unauthorized' });
    if (hierarchy.indexOf(userRole) < hierarchy.indexOf(minRole)) {
      return res.status(403).json({ error: `Requires ${minRole} or higher` });
    }
    next();
  };
}

router.get("/users", authenticateToken, requireRole('SUPERVISOR'), (req, res) => {
  try {
    const { role, areaId, search, includeInactive } = req.query;
    const viewerRole = req.user.role;
    const viewerId = req.user.id;

    let query = `SELECT id, name, email, role, title, phone, area_id, supervisor_id, is_active, created_at, last_login_at FROM users WHERE 1=1`;
    const params = [];

    // Role-based filtering
    if (viewerRole === 'SUPERVISOR') {
      // Supervisors can only see their own techs/trainees/trainers
      query += ` AND (supervisor_id = ? OR id = ?)`;
      params.push(viewerId, viewerId);
    } else if (viewerRole === 'AREA_MANAGER') {
      // Area managers can see all users in their areas plus their supervisor chain
      query += ` AND (area_id IN (SELECT id FROM areas WHERE manager_id = ?) OR supervisor_id IN (SELECT id FROM users WHERE supervisor_id = ?) OR id = ?)`;
      params.push(viewerId, viewerId, viewerId);
    }
    // MANAGER can see all users (no filter)

    if (role) {
      query += ` AND role = ?`;
      params.push(role);
    }
    if (areaId) {
      query += ` AND area_id = ?`;
      params.push(areaId);
    }
    if (!includeInactive || includeInactive === 'false') {
      query += ` AND is_active = 1`;
    }
    if (search) {
      query += ` AND (name LIKE ? OR email LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s);
    }

    query += ` ORDER BY name ASC`;

    const users = db.prepare(query).all(...params);
    res.json({ users });
  } catch (error) {
    console.error("[OPS Users] Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.get("/users/:id", authenticateToken, requireRole('SUPERVISOR'), (req, res) => {
  try {
    const { id } = req.params;
    const user = db.prepare(`
      SELECT u.*, s.name as supervisor_name, a.name as area_name
      FROM users u
      LEFT JOIN users s ON s.id = u.supervisor_id
      LEFT JOIN areas a ON a.id = u.area_id
      WHERE u.id = ?
    `).get(id);

    if (!user) return res.status(404).json({ error: "User not found" });

    // Authorization check
    const viewerRole = req.user.role;
    const viewerId = req.user.id;
    if (viewerRole === 'SUPERVISOR' && user.supervisor_id !== viewerId && user.id !== viewerId) {
      return res.status(403).json({ error: "Can only view users in your chain" });
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      title: user.title,
      phone: user.phone,
      areaId: user.area_id,
      areaName: user.area_name,
      supervisorId: user.supervisor_id,
      supervisorName: user.supervisor_name,
      isActive: user.is_active === 1,
      passwordMustChange: user.password_must_change === 1,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
    });
  } catch (error) {
    console.error("[OPS Users] Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

router.post("/users", authenticateToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const {
      name, email, password, title, role, supervisorId, areaId, phone,
      territoryId, territoryIds, assignmentType,
    } = req.body;
    const viewerRole = req.user.role;
    const viewerId = req.user.id;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "Name, email, password, and role are required" });
    }

    // Validate role hierarchy (now includes DISTRICT_MANAGER)
    const hierarchy = ['TRAINEE', 'TRAINER', 'TECH', 'SUPERVISOR', 'AREA_MANAGER', 'DISTRICT_MANAGER', 'MANAGER'];
    if (!hierarchy.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    // Authorization: supervisor can only create TRAINEE/TRAINER/TECH under themselves
    if (viewerRole === 'SUPERVISOR') {
      if (!['TRAINEE', 'TRAINER', 'TECH'].includes(role)) {
        return res.status(403).json({ error: "Supervisors can only create tech/trainee/trainer roles" });
      }
      if (supervisorId && supervisorId !== viewerId) {
        return res.status(403).json({ error: "Can only assign users to yourself as supervisor" });
      }
    } else if (viewerRole === 'AREA_MANAGER') {
      if (['MANAGER', 'DISTRICT_MANAGER', 'AREA_MANAGER'].includes(role)) {
        return res.status(403).json({ error: "Area managers cannot create area/district/system managers" });
      }
    } else if (viewerRole === 'DISTRICT_MANAGER') {
      if (['MANAGER', 'DISTRICT_MANAGER'].includes(role)) {
        return res.status(403).json({ error: "Only system managers can create district/system managers" });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = Date.now();
    const existing = db.prepare("SELECT id, is_active FROM users WHERE email = ?").get(email);

    const ROLE_TO_ASSIGNMENT = {
      DISTRICT_MANAGER: 'OWNER',
      AREA_MANAGER: 'OWNER',
      SUPERVISOR: 'OWNER',
      TRAINER: 'TECH_ASSIGNMENT',
      TECH: 'TECH_ASSIGNMENT',
      TRAINEE: 'TECH_ASSIGNMENT',
    };
    const assignTerritory = (userId) => {
      // Support both legacy single territoryId and new territoryIds array.
      const ids = Array.isArray(territoryIds) && territoryIds.length > 0
        ? territoryIds
        : territoryId ? [territoryId] : [];
      if (ids.length === 0) return null;
      const finalType = assignmentType || ROLE_TO_ASSIGNMENT[role] || 'TECH_ASSIGNMENT';
      const assigned = [];
      for (const tid of ids) {
        const t = db.prepare(`SELECT id, type FROM territories WHERE id = ?`).get(tid);
        if (!t) continue;
        const utaId = `uta-${userId}-${t.id}-${finalType.toLowerCase()}`;
        db.prepare(`
          INSERT OR IGNORE INTO user_territory_assignments (id, user_id, territory_id, assignment_type, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(utaId, userId, t.id, finalType, now);
        assigned.push({ territoryId: t.id, assignmentType: finalType });
      }
      return assigned.length > 0 ? assigned : null;
    };

    if (existing && existing.is_active === 1) {
      return res.status(409).json({ error: "Email already exists" });
    }

    if (existing && existing.is_active === 0) {
      const userId = existing.id;
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM user_territory_assignments WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM user_areas WHERE user_id = ?").run(userId);
        db.prepare(`
          UPDATE users
          SET name = ?, password_hash = ?, role = ?, title = ?, phone = ?, area_id = ?, supervisor_id = ?,
              is_active = 1, password_must_change = 1, updated_at = ?
          WHERE id = ?
        `).run(
          name,
          passwordHash,
          role,
          title || null,
          phone || null,
          areaId || null,
          supervisorId || null,
          now,
          userId,
        );
        return assignTerritory(userId);
      });
      const assignedTerritory = tx();

      console.log(`[OPS Users] Reactivated user ${email} (${role}) by ${req.user.email}${assignedTerritory ? ` assigned to ${assignedTerritory.map(a => a.territoryId).join(', ')}` : ''}`);
      emitOpsEvent("user.reactivated", { userId, email, role, by: req.user.id, territoryIds: assignedTerritory?.map(a => a.territoryId) });

      return res.status(200).json({
        id: userId,
        name,
        email,
        role,
        title,
        phone,
        areaId,
        supervisorId,
        territoryAssignments: assignedTerritory,
        passwordMustChange: true,
      });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, title, phone, area_id, supervisor_id, is_active, password_must_change, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    `).run(id, name, email, passwordHash, role, title || null, phone || null, areaId || null, supervisorId || null, now, now);

    const assignedTerritory = assignTerritory(id);

    console.log(`[OPS Users] Created user ${email} (${role}) by ${req.user.email}${assignedTerritory ? ` assigned to ${assignedTerritory.map(a => a.territoryId).join(', ')}` : ''}`);
    emitOpsEvent("user.created", { userId: id, email, role, by: req.user.id, territoryIds: assignedTerritory?.map(a => a.territoryId) });

    res.status(201).json({
      id,
      name,
      email,
      role,
      title,
      phone,
      areaId,
      supervisorId,
      territoryAssignments: assignedTerritory,
      passwordMustChange: true,
    });
  } catch (error) {
    console.error("[OPS Users] Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.patch("/users/:id", authenticateToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, title, role, supervisorId, areaId, phone, isActive } = req.body;
    const viewerRole = req.user.role;
    const viewerId = req.user.id;

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Authorization checks
    if (viewerRole === 'SUPERVISOR') {
      if (user.supervisor_id !== viewerId && user.id !== viewerId) {
        return res.status(403).json({ error: "Can only edit users in your chain" });
      }
      if (role && !['TRAINEE', 'TRAINER', 'TECH'].includes(role)) {
        return res.status(403).json({ error: "Can only assign tech/trainee/trainer roles" });
      }
    } else if (viewerRole === 'AREA_MANAGER') {
      if (role === 'MANAGER') {
        return res.status(403).json({ error: "Cannot promote to manager" });
      }
    }

    // Check email uniqueness if changing
    if (email && email !== user.email) {
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) {
        return res.status(409).json({ error: "Email already exists" });
      }
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push("name = ?"); params.push(name); }
    if (email !== undefined) { updates.push("email = ?"); params.push(email); }
    if (title !== undefined) { updates.push("title = ?"); params.push(title); }
    if (role !== undefined) { updates.push("role = ?"); params.push(role); }
    if (phone !== undefined) { updates.push("phone = ?"); params.push(phone); }
    if (supervisorId !== undefined) { updates.push("supervisor_id = ?"); params.push(supervisorId); }
    if (areaId !== undefined) { updates.push("area_id = ?"); params.push(areaId); }
    if (isActive !== undefined) { updates.push("is_active = ?"); params.push(isActive ? 1 : 0); }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push("updated_at = ?");
    params.push(Date.now());
    params.push(id);

    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    console.log(`[OPS Users] Updated user ${user.email} by ${req.user.email}`);
    emitOpsEvent("user.updated", { userId: id, by: req.user.id });

    res.json({ ok: true, userId: id });
  } catch (error) {
    console.error("[OPS Users] Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.post("/users/:id/reset-password", authenticateToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const viewerRole = req.user.role;
    const viewerId = req.user.id;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Authorization: cannot reset a superior's password
    const hierarchy = ['TRAINEE', 'TRAINER', 'TECH', 'SUPERVISOR', 'AREA_MANAGER', 'MANAGER'];
    if (hierarchy.indexOf(user.role) > hierarchy.indexOf(viewerRole)) {
      return res.status(403).json({ error: "Cannot reset password for a superior role" });
    }

    // Additional check: supervisors can only reset their own chain
    if (viewerRole === 'SUPERVISOR' && user.supervisor_id !== viewerId) {
      return res.status(403).json({ error: "Can only reset passwords for users in your chain" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    db.prepare("UPDATE users SET password_hash = ?, password_must_change = 1 WHERE id = ?")
      .run(passwordHash, id);

    console.log(`[OPS Users] Password reset for ${user.email} by ${req.user.email}`);
    emitOpsEvent("user.password_reset", { userId: id, by: req.user.id });

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("[OPS Users] Error resetting password:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

router.delete("/users/:id", authenticateToken, requireRole('SUPERVISOR'), (req, res) => {
  try {
    const { id } = req.params;
    const viewerRole = req.user.role;
    const viewerId = req.user.id;
    const hierarchy = ['TRAINEE', 'TRAINER', 'TECH', 'SUPERVISOR', 'AREA_MANAGER', 'DISTRICT_MANAGER', 'MANAGER'];

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Authorization checks
    if (hierarchy.indexOf(user.role) > hierarchy.indexOf(viewerRole)) {
      return res.status(403).json({ error: "Cannot deactivate a superior role" });
    }
    if (viewerRole === 'SUPERVISOR' && user.supervisor_id !== viewerId) {
      return res.status(403).json({ error: "Can only deactivate users in your chain" });
    }

    const now = Date.now();
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM user_territory_assignments WHERE user_id = ?").run(id);
      db.prepare("DELETE FROM user_areas WHERE user_id = ?").run(id);
      db.prepare("UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?")
        .run(now, id);
    });
    tx();

    console.log(`[OPS Users] Deactivated user ${user.email} by ${req.user.email}`);
    emitOpsEvent("user.deactivated", { userId: id, by: req.user.id });

    res.json({ message: "User deactivated successfully" });
  } catch (error) {
    console.error("[OPS Users] Error deactivating user:", error);
    res.status(500).json({ error: "Failed to deactivate user" });
  }
});

// ---------- manual ticket assignment ----------

router.patch("/tickets/:id/assign", authenticateToken, requireRole('SUPERVISOR'), (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTechId } = req.body;
    const viewerRole = req.user.role;
    const viewerId = req.user.id;

    if (!assignedTechId) {
      return res.status(400).json({ error: "assignedTechId is required" });
    }

    const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    // Cannot assign closed/unable tickets
    if (ticket.locator_status === 'CLOSED' || ticket.locator_status === 'UNABLE') {
      return res.status(400).json({ error: "Cannot reassign closed or unable tickets" });
    }

    // Verify target tech exists and is active
    const tech = db.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1").get(assignedTechId);
    if (!tech) return res.status(404).json({ error: "Technician not found or inactive" });

    // Authorization: caller must be able to manage this tech
    if (viewerRole === 'SUPERVISOR') {
      if (tech.supervisor_id !== viewerId) {
        return res.status(403).json({ error: "Can only assign to techs in your chain" });
      }
    } else if (viewerRole === 'AREA_MANAGER') {
      // Area manager can assign to techs in areas they manage
      const managesArea = db.prepare("SELECT 1 FROM areas WHERE id = ? AND manager_id = ?")
        .get(tech.area_id, viewerId);
      if (!managesArea && tech.id !== viewerId) {
        return res.status(403).json({ error: "Can only assign to techs in your areas" });
      }
    }
    // MANAGER can assign to anyone

    const result = assignTicketInternal(id, assignedTechId, viewerId);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ ok: true, ticketId: id, assignedTechId });
  } catch (error) {
    console.error("[OPS Tickets] Error assigning ticket:", error);
    res.status(500).json({ error: "Failed to assign ticket" });
  }
});

router.patch("/tickets/:id/unassign", authenticateToken, requireRole('SUPERVISOR'), (req, res) => {
  try {
    const { id } = req.params;
    const viewerRole = req.user.role;
    const viewerId = req.user.id;

    const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    // Cannot unassign closed/unable tickets
    if (ticket.locator_status === 'CLOSED' || ticket.locator_status === 'UNABLE') {
      return res.status(400).json({ error: "Cannot unassign closed or unable tickets" });
    }

    // Authorization check
    if (viewerRole === 'SUPERVISOR') {
      const tech = ticket.assigned_tech_id ?
        db.prepare("SELECT supervisor_id FROM users WHERE id = ?").get(ticket.assigned_tech_id) : null;
      if (tech && tech.supervisor_id !== viewerId) {
        return res.status(403).json({ error: "Can only unassign tickets from your techs" });
      }
    }
    // AREA_MANAGER and MANAGER can unassign any

    // Set assigned_tech_id to NULL and update version
    const now = Date.now();
    db.prepare(`
      UPDATE tickets
      SET assigned_tech_id = NULL, status = 'OPEN', updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(now, id);

    // Create event
    const eventId = uuidv4();
    db.prepare(`
      INSERT INTO ticket_events (id, ticket_id, event_type, old_locator_status, new_locator_status, user_id, notes, created_at)
      VALUES (?, ?, 'UNASSIGNED', ?, NULL, ?, 'Manually unassigned', ?)
    `).run(eventId, id, ticket.locator_status, resolveActorUserId(viewerId), now);

    emitOpsEvent("ticket.unassigned", { ticketId: id, previousTechId: ticket.assigned_tech_id, by: viewerId });

    res.json({ ok: true, ticketId: id });
  } catch (error) {
    console.error("[OPS Tickets] Error unassigning ticket:", error);
    res.status(500).json({ error: "Failed to unassign ticket" });
  }
});

// ---------- areas management ----------

// Helper: get area ids the user has access to
// MANAGER sees all; others see only areas in user_areas table assigned to them
function getAccessibleAreaIds(userId, userRole) {
  if (userRole === 'MANAGER') {
    return db.prepare("SELECT id FROM areas WHERE active = 1").all().map(a => a.id);
  }
  return db.prepare(`
    SELECT a.id FROM areas a
    INNER JOIN user_areas ua ON ua.area_id = a.id
    WHERE ua.user_id = ? AND a.active = 1
  `).all(userId).map(a => a.id);
}

router.get("/areas", authenticateToken, (req, res) => {
  try {
    const viewerId = req.user.id;
    const viewerRole = req.user.role;
    const { all } = req.query; // ?all=1 returns all areas (for managers)

    let areas;
    if (viewerRole === 'MANAGER' || all === '1') {
      areas = db.prepare(`
        SELECT a.*, u.name as manager_name,
               (SELECT COUNT(*) FROM users u2 WHERE u2.area_id = a.id AND u2.is_active = 1 AND u2.role IN ('TRAINEE','TRAINER','TECH')) as tech_count
        FROM areas a
        LEFT JOIN users u ON u.id = a.manager_id
        WHERE a.active = 1
        ORDER BY a.name ASC
      `).all();
    } else {
      // Return only areas assigned to this user
      areas = db.prepare(`
        SELECT a.*, u.name as manager_name,
               (SELECT COUNT(*) FROM users u2 WHERE u2.area_id = a.id AND u2.is_active = 1 AND u2.role IN ('TRAINEE','TRAINER','TECH')) as tech_count
        FROM areas a
        INNER JOIN user_areas ua ON ua.area_id = a.id
        LEFT JOIN users u ON u.id = a.manager_id
        WHERE a.active = 1 AND ua.user_id = ?
        ORDER BY a.name ASC
      `).all(viewerId);
    }

    // Normalize to camelCase expected by frontend
    const normalized = areas.map(a => ({
      id: a.id,
      name: a.name,
      managerId: a.manager_id,
      managerName: a.manager_name,
      techCount: a.tech_count,
      active: a.active === 1,
      bboxNorth: a.bbox_north,
      bboxSouth: a.bbox_south,
      bboxEast: a.bbox_east,
      bboxWest: a.bbox_west,
      centerLat: a.center_lat,
      centerLng: a.center_lng,
      color: a.color || '#3B82F6',
    }));

    res.json({ areas: normalized });
  } catch (error) {
    console.error("[OPS Areas] Error fetching areas:", error);
    res.status(500).json({ error: "Failed to fetch areas" });
  }
});

// Get detailed info for a single area (techs assigned, tickets in area, assignees)
router.get("/areas/:id/details", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const area = db.prepare("SELECT * FROM areas WHERE id = ?").get(id);
    if (!area) return res.status(404).json({ error: "Area not found" });

    // Users assigned to this area via user_areas (any role)
    const assignees = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, ua.assigned_at
      FROM users u
      INNER JOIN user_areas ua ON ua.user_id = u.id
      WHERE ua.area_id = ? AND u.is_active = 1
      ORDER BY
        CASE u.role
          WHEN 'MANAGER' THEN 1
          WHEN 'AREA_MANAGER' THEN 2
          WHEN 'SUPERVISOR' THEN 3
          WHEN 'TRAINER' THEN 4
          WHEN 'TECH' THEN 5
          WHEN 'TRAINEE' THEN 6
        END, u.name
    `).all(id);

    // Techs whose primary area_id is this area
    const primaryTechs = db.prepare(`
      SELECT id, name, email, role
      FROM users
      WHERE area_id = ? AND is_active = 1 AND role IN ('TRAINEE','TRAINER','TECH')
      ORDER BY name
    `).all(id);

    // Tickets with lat/lng in area's bbox (or all if no bbox)
    let ticketQuery;
    let ticketParams;
    if (area.bbox_north !== null && area.bbox_south !== null) {
      ticketQuery = `
        SELECT id, ticket_number, address, lat, lng, locator_status, assigned_tech_id
        FROM tickets
        WHERE lat IS NOT NULL AND lng IS NOT NULL
          AND lat BETWEEN ? AND ?
          AND lng BETWEEN ? AND ?
          AND locator_status NOT IN ('CLOSED', 'UNABLE')
        LIMIT 500
      `;
      ticketParams = [area.bbox_south, area.bbox_north, area.bbox_west, area.bbox_east];
    } else {
      ticketQuery = `
        SELECT id, ticket_number, address, lat, lng, locator_status, assigned_tech_id
        FROM tickets
        WHERE assigned_tech_id IN (SELECT id FROM users WHERE area_id = ?)
          AND locator_status NOT IN ('CLOSED', 'UNABLE')
        LIMIT 500
      `;
      ticketParams = [id];
    }
    const tickets = db.prepare(ticketQuery).all(...ticketParams);

    res.json({
      area: {
        id: area.id,
        name: area.name,
        managerId: area.manager_id,
        bboxNorth: area.bbox_north,
        bboxSouth: area.bbox_south,
        bboxEast: area.bbox_east,
        bboxWest: area.bbox_west,
        centerLat: area.center_lat,
        centerLng: area.center_lng,
        color: area.color || '#3B82F6',
        active: area.active === 1,
      },
      assignees,
      primaryTechs,
      tickets,
    });
  } catch (error) {
    console.error("[OPS Areas] Error fetching area details:", error);
    res.status(500).json({ error: "Failed to fetch area details" });
  }
});

// Assign areas to a user (replaces existing)
router.put("/users/:id/areas", authenticateToken, requireRole('SUPERVISOR'), (req, res) => {
  try {
    const { id: userId } = req.params;
    const { areaIds } = req.body;
    const viewerId = req.user.id;
    const viewerRole = req.user.role;

    if (!Array.isArray(areaIds)) {
      return res.status(400).json({ error: "areaIds must be an array" });
    }

    const targetUser = db.prepare("SELECT id, role FROM users WHERE id = ?").get(userId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Authorization: can only assign areas the viewer has access to
    const accessibleAreaIds = getAccessibleAreaIds(viewerId, viewerRole);
    const invalidArea = areaIds.find(aid => !accessibleAreaIds.includes(aid));
    if (invalidArea) {
      return res.status(403).json({ error: `You don't have access to area ${invalidArea}` });
    }

    const tx = db.transaction(() => {
      // Remove existing assignments
      db.prepare("DELETE FROM user_areas WHERE user_id = ?").run(userId);

      // Insert new assignments
      const insert = db.prepare(`
        INSERT INTO user_areas (user_id, area_id, assigned_by, assigned_at)
        VALUES (?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const areaId of areaIds) {
        insert.run(userId, areaId, viewerId, now);
      }
    });
    tx();

    emitOpsEvent("user.areas.updated", { userId, areaIds, by: viewerId });
    res.json({ ok: true, areaIds });
  } catch (error) {
    console.error("[OPS Areas] Error updating user areas:", error);
    res.status(500).json({ error: "Failed to update user areas" });
  }
});

// Get areas assigned to a specific user
router.get("/users/:id/areas", authenticateToken, (req, res) => {
  try {
    const { id: userId } = req.params;
    const areas = db.prepare(`
      SELECT a.id, a.name, a.color, ua.assigned_at
      FROM areas a
      INNER JOIN user_areas ua ON ua.area_id = a.id
      WHERE ua.user_id = ? AND a.active = 1
      ORDER BY a.name
    `).all(userId);
    res.json({ areas });
  } catch (error) {
    console.error("[OPS Areas] Error fetching user areas:", error);
    res.status(500).json({ error: "Failed to fetch user areas" });
  }
});

router.post("/areas", authenticateToken, requireRole('AREA_MANAGER'), (req, res) => {
  try {
    const { name, managerId } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const id = uuidv4();
    const now = Date.now();

    db.prepare(`
      INSERT INTO areas (id, name, manager_id, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(id, name, managerId || null, now, now);

    emitOpsEvent("area.created", { areaId: id, name, by: req.user.id });
    res.status(201).json({ id, name, managerId });
  } catch (error) {
    console.error("[OPS Areas] Error creating area:", error);
    res.status(500).json({ error: "Failed to create area" });
  }
});

router.patch("/areas/:id", authenticateToken, requireRole('AREA_MANAGER'), (req, res) => {
  try {
    const { id } = req.params;
    const { name, managerId, active } = req.body;
    const viewerRole = req.user.role;

    const area = db.prepare("SELECT * FROM areas WHERE id = ?").get(id);
    if (!area) return res.status(404).json({ error: "Area not found" });

    // Only managers can change area manager
    if (managerId !== undefined && viewerRole !== 'MANAGER') {
      return res.status(403).json({ error: "Only managers can change area managers" });
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push("name = ?"); params.push(name); }
    if (managerId !== undefined) { updates.push("manager_id = ?"); params.push(managerId); }
    if (active !== undefined) { updates.push("active = ?"); params.push(active ? 1 : 0); }

    if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });

    updates.push("updated_at = ?");
    params.push(Date.now());
    params.push(id);

    db.prepare(`UPDATE areas SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    emitOpsEvent("area.updated", { areaId: id, by: req.user.id });
    res.json({ ok: true });
  } catch (error) {
    console.error("[OPS Areas] Error updating area:", error);
    res.status(500).json({ error: "Failed to update area" });
  }
});

export default router;
