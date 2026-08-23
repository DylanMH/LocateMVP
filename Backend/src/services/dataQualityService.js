import { getUserDirectTerritories } from './territoryService.js';

function parsePayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function issue(type, severity, entityType, entityId, message) {
  return { type, severity, entityType, entityId, message };
}

/**
 * Run all data-quality checks and return the issues. Supports optional
 * filtering by severity and entityType, plus offset-based pagination.
 *
 * @param {object} db
 * @param {number} limit - max issues to return (after filtering)
 * @param {{ severity?: string, entityType?: string, offset?: number }} options
 */
export function runDataQualityChecks(db, limit = 250, options = {}) {
  const { severity, entityType, offset = 0 } = options;
  const allIssues = [];
  const add = (...args) => {
    allIssues.push(issue(...args));
  };

  // --- Ticket-level checks ---
  for (const ticket of db.prepare(
    "SELECT id, ticket_number, status, locator_status, assigned_tech_id, payload_json, due_at, closed_at FROM tickets",
  ).all()) {
    const payload = parsePayload(ticket.payload_json);
    const customers = Array.isArray(payload.customers) ? payload.customers : [];
    const markings = payload.customerMarkings || payload.customerMarking || {};

    if (ticket.status === 'CLOSED' && !ticket.closed_at) {
      add('COMPLETED_MISSING_CLOSED_AT', 'ERROR', 'TICKET', ticket.id, `${ticket.ticket_number} is closed without closed_at`);
    }
    if (!ticket.assigned_tech_id && !['CLOSED', 'UNABLE'].includes(ticket.locator_status)) {
      add('TICKET_WITHOUT_TECH', 'WARN', 'TICKET', ticket.id, `${ticket.ticket_number} is active without an assigned technician`);
    }
    if (ticket.status === 'CLOSED') {
      for (const customer of customers) {
        const marking = markings[customer.id];
        if (!marking?.status && !marking?.result) {
          add('COMPLETED_CUSTOMER_MISSING_STATUS', 'ERROR', 'TICKET', ticket.id, `${ticket.ticket_number} customer ${customer.id} has no outcome`);
        }
        if ((marking?.status === 'MARKED' || ['PAINT_AND_FLAG', 'PAINT_ONLY', 'FLAG_ONLY'].includes(marking?.result))
          && Number(marking?.footage || 0) <= 0) {
          add('MARKED_CUSTOMER_MISSING_FOOTAGE', 'WARN', 'TICKET', ticket.id, `${ticket.ticket_number} marked customer ${customer.id} has no footage`);
        }
      }
    }

    // Overdue completion check
    if (ticket.closed_at && ticket.due_at && Number(ticket.due_at) > 0
      && Number(ticket.closed_at) > Number(ticket.due_at)) {
      add('OVERDUE_COMPLETION', 'WARN', 'TICKET', ticket.id, `${ticket.ticket_number} was completed after its due date`);
    }

    // Missing due_at on active ticket
    if (!ticket.due_at && !['CLOSED', 'UNABLE'].includes(ticket.locator_status)) {
      add('ACTIVE_TICKET_MISSING_DUE_AT', 'WARN', 'TICKET', ticket.id, `${ticket.ticket_number} is active without a due_at`);
    }
  }

  // --- Timesheet-level checks ---
  for (const row of db.prepare(
    "SELECT user_id, COUNT(*) AS count FROM day_sessions WHERE status = 'ACTIVE' GROUP BY user_id HAVING COUNT(*) > 1",
  ).all()) {
    add('DUPLICATE_ACTIVE_SESSIONS', 'ERROR', 'USER', row.user_id, `${row.count} active day sessions exist`);
  }

  const sessions = db.prepare(
    'SELECT id, user_id, date, clock_in_at, clock_out_at FROM day_sessions WHERE clock_in_at IS NOT NULL ORDER BY user_id, date, clock_in_at',
  ).all();
  for (let index = 1; index < sessions.length; index += 1) {
    const previous = sessions[index - 1];
    const current = sessions[index];
    if (previous.user_id === current.user_id
      && previous.date === current.date
      && previous.clock_out_at
      && current.clock_in_at < previous.clock_out_at) {
      add('OVERLAPPING_TIMESHEET_SESSIONS', 'ERROR', 'USER', current.user_id, `${previous.id} overlaps ${current.id} on ${current.date}`);
    }
  }

  // Open session without clock_out for >24h
  const staleSessions = db.prepare(`
    SELECT id, user_id, clock_in_at FROM day_sessions
    WHERE status = 'ACTIVE' AND clock_in_at < ?
  `).all(Date.now() - 24 * 60 * 60 * 1000);
  for (const s of staleSessions) {
    add('STALE_OPEN_SESSION', 'WARN', 'USER', s.user_id, `Session ${s.id} has been open for over 24 hours`);
  }

  // --- User hierarchy checks ---
  for (const user of db.prepare(
    "SELECT id, name, role, supervisor_id FROM users WHERE is_active = 1 AND role IN ('TRAINEE', 'TRAINER', 'TECH')",
  ).all()) {
    if (!user.supervisor_id) {
      add('TECH_WITHOUT_SUPERVISOR', 'WARN', 'USER', user.id, `${user.name} has no supervisor assignment`);
    }
  }

  for (const supervisor of db.prepare(
    "SELECT id, name FROM users WHERE is_active = 1 AND role = 'SUPERVISOR'",
  ).all()) {
    const territories = getUserDirectTerritories(db, supervisor.id);
    if (territories.AREA.length === 0 && territories.SUPERVISOR_TERRITORY.length === 0) {
      add('SUPERVISOR_WITHOUT_AREA_MANAGER', 'WARN', 'USER', supervisor.id, `${supervisor.name} has no area manager territory assignment`);
    }
  }

  for (const areaManager of db.prepare(
    "SELECT id, name FROM users WHERE is_active = 1 AND role = 'AREA_MANAGER'",
  ).all()) {
    const territories = getUserDirectTerritories(db, areaManager.id);
    if (territories.AREA.length === 0) {
      add('AREA_MANAGER_WITHOUT_AREA', 'WARN', 'USER', areaManager.id, `${areaManager.name} has no area assignment`);
    }
  }

  // --- Customer checks ---
  for (const customer of db.prepare(
    "SELECT id, display_name, utility_type, contracted_locator_id FROM customers WHERE active = 1",
  ).all()) {
    if (!customer.utility_type) {
      add('CUSTOMER_WITHOUT_UTILITY_TYPE', 'ERROR', 'CUSTOMER', customer.id, `${customer.display_name} has no utility type`);
    }
  }

  // --- Apply filters ---
  let filtered = allIssues;
  if (severity) {
    filtered = filtered.filter((i) => i.severity === severity.toUpperCase());
  }
  if (entityType) {
    filtered = filtered.filter((i) => i.entityType === entityType.toUpperCase());
  }

  const totalCount = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    issueCount: totalCount,
    returnedCount: paginated.length,
    truncated: totalCount > offset + limit,
    offset,
    limit,
    byType: allIssues.reduce((counts, current) => {
      counts[current.type] = (counts[current.type] || 0) + 1;
      return counts;
    }, {}),
    bySeverity: allIssues.reduce((counts, current) => {
      counts[current.severity] = (counts[current.severity] || 0) + 1;
      return counts;
    }, {}),
    byEntityType: allIssues.reduce((counts, current) => {
      counts[current.entityType] = (counts[current.entityType] || 0) + 1;
      return counts;
    }, {}),
    issues: paginated,
  };
}
