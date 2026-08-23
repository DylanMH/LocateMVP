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

export function runDataQualityChecks(db, limit = 250) {
  const issues = [];
  const add = (...args) => {
    if (issues.length < limit) issues.push(issue(...args));
  };

  for (const ticket of db.prepare(
    "SELECT id, ticket_number, status, locator_status, assigned_tech_id, payload_json FROM tickets",
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
  }

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
    if (territories.AREA.length === 0) {
      add('SUPERVISOR_WITHOUT_AREA_MANAGER', 'WARN', 'USER', supervisor.id, `${supervisor.name} has no area manager territory assignment`);
    }
  }

  for (const customer of db.prepare(
    "SELECT id, display_name, utility_type FROM customers WHERE active = 1",
  ).all()) {
    if (!customer.utility_type) {
      add('CUSTOMER_WITHOUT_UTILITY_TYPE', 'ERROR', 'CUSTOMER', customer.id, `${customer.display_name} has no utility type`);
    }
  }

  return {
    issueCount: issues.length,
    truncated: issues.length >= limit,
    byType: issues.reduce((counts, current) => {
      counts[current.type] = (counts[current.type] || 0) + 1;
      return counts;
    }, {}),
    issues,
  };
}
