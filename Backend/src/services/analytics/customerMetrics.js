import { summarizeTicketMetrics } from './ticketMetrics.js';

function parsePayload(ticket) {
  try {
    return JSON.parse(ticket.payload_json || '{}');
  } catch {
    return {};
  }
}

export function projectCustomerTickets(tickets, customer) {
  return tickets.flatMap((ticket) => {
    const payload = parsePayload(ticket);
    const markings = payload.customerMarkings || payload.customerMarking || {};
    const customerRows = Array.isArray(payload.customers) ? payload.customers : [];
    const matching = customerRows.filter((row) => (
      row?.name === customer.display_name
      && (row?.utility || row?.utilityType) === customer.utility_type
    ));

    return matching.map((row) => ({
      ...ticket,
      payload_json: JSON.stringify({
        customers: [{ id: row.id }],
        customerMarkings: { [row.id]: markings[row.id] || {} },
      }),
    }));
  });
}

/**
 * Compute average onsite minutes from ticket payload.
 */
function getOnsiteMinutes(ticket) {
  const payload = parsePayload(ticket);
  if (!payload.onsiteStartedAt) return 0;
  const end = payload.closedAt || payload.onsiteEndedAt || ticket.closed_at || Date.now();
  const ms = Math.max(0, end - payload.onsiteStartedAt);
  return ms / 60000;
}

/**
 * Compute average total minutes per ticket (from utility_production_ledger
 * or from ticket time allocation).
 */
function getTicketMinutes(ticket) {
  const payload = parsePayload(ticket);
  const markings = payload.customerMarkings || payload.customerMarking || {};
  const customers = Array.isArray(payload.customers) ? payload.customers : [];
  let totalMinutes = 0;
  for (const c of customers) {
    const m = markings[c.id];
    if (m?.minutes) {
      const mins = Number(m.minutes);
      if (Number.isFinite(mins)) totalMinutes += mins;
    }
  }
  return totalMinutes;
}

export function summarizeCustomerMetrics(tickets, customer) {
  const customerTickets = projectCustomerTickets(tickets, customer);
  const metrics = summarizeTicketMetrics(customerTickets);
  const overdueCompletions = customerTickets.filter((ticket) => (
    Number(ticket.due_at) > 0
    && Number(ticket.closed_at) > Number(ticket.due_at)
  )).length;

  // Open ticket count (not closed/unable)
  const openTickets = customerTickets.filter((t) =>
    t.locator_status !== 'CLOSED' && t.locator_status !== 'UNABLE'
  ).length;

  // Clear percentage
  const clearRate = metrics.completed > 0
    ? { value: (metrics.fullyClear / metrics.completed) * 100, numerator: metrics.fullyClear, denominator: metrics.completed }
    : { value: null, numerator: 0, denominator: 0 };

  // Average minutes per completed ticket
  const completedTickets = customerTickets.filter((t) => t.closed_at != null);
  const totalMinutes = completedTickets.reduce((sum, t) => sum + getTicketMinutes(t), 0);
  const averageMinutesPerTicket = completedTickets.length > 0 ? totalMinutes / completedTickets.length : null;

  // Average onsite minutes per completed ticket
  const totalOnsiteMinutes = completedTickets.reduce((sum, t) => sum + getOnsiteMinutes(t), 0);
  const averageOnsiteMinutes = completedTickets.length > 0 ? totalOnsiteMinutes / completedTickets.length : null;

  // Emergency ticket volume
  const emergencyTickets = customerTickets.filter((t) => t.ticket_type === 'EMERGENCY').length;

  // Reschedule count
  const rescheduleCount = customerTickets.reduce((sum, t) => {
    const originalDue = Number(t.original_due_at || 0);
    const currentDue = Number(t.due_at || 0);
    return sum + (originalDue > 0 && currentDue > 0 && originalDue !== currentDue ? 1 : 0);
  }, 0);

  return {
    ...metrics,
    ticketCount: customerTickets.length,
    openTickets,
    clearRate,
    overdueCompletions,
    averageFootagePerMarkedTicket: metrics.markedTickets > 0
      ? metrics.markedFootage / metrics.markedTickets
      : null,
    averageMinutesPerTicket,
    averageOnsiteMinutes,
    emergencyTickets,
    rescheduleCount,
  };
}

/**
 * Compute customer metric breakdowns by technician, supervisor, area, date,
 * and ticket type. Each breakdown returns an array of rows with per-group
 * metrics. All rows include numerator/denominator fields for sorting.
 *
 * @param {Array} tickets - all tickets in scope (already filtered by time range)
 * @param {object} customer - the customer catalog row
 * @param {object} db - database instance for tech/supervisor/area lookups
 * @returns {{ byTechnician: Array, bySupervisor: Array, byArea: Array, byDate: Array, byTicketType: Array }}
 */
export function summarizeCustomerBreakdowns(tickets, customer, db) {
  const customerTickets = projectCustomerTickets(tickets, customer);

  // Build tech → supervisor → area lookup
  const techMap = new Map();
  const supMap = new Map();
  const areaMap = new Map();
  if (db) {
    const techs = db.prepare(`
      SELECT u.id, u.name, u.supervisor_id,
             s.name as supervisor_name,
             st.id as supervisor_territory_id, st.name as supervisor_territory_name,
             at.id as area_territory_id, at.name as area_territory_name
      FROM users u
      LEFT JOIN users s ON s.id = u.supervisor_id
      LEFT JOIN user_territory_assignments uta ON uta.user_id = u.id AND uta.assignment_type = 'TECH_ASSIGNMENT'
      LEFT JOIN territories tt ON tt.id = uta.territory_id
      LEFT JOIN territories st ON st.id = tt.parent_territory_id
      LEFT JOIN territories at ON at.id = st.parent_territory_id
      WHERE u.role IN ('TECH','TRAINEE','TRAINER') AND u.is_active = 1
    `).all();
    for (const t of techs) {
      techMap.set(t.id, t);
    }
  }

  // Group by technician
  const byTechMap = new Map();
  for (const ticket of customerTickets) {
    const techId = ticket.assigned_tech_id || 'UNASSIGNED';
    if (!byTechMap.has(techId)) byTechMap.set(techId, []);
    byTechMap.get(techId).push(ticket);
  }
  const byTechnician = Array.from(byTechMap.entries()).map(([techId, tix]) => {
    const techInfo = techMap.get(techId);
    const m = summarizeTicketMetrics(tix);
    return {
      techId,
      techName: techInfo?.name || (techId === 'UNASSIGNED' ? 'Unassigned' : techId),
      ticketCount: tix.length,
      completed: m.completed,
      fullyClear: m.fullyClear,
      fullyMarked: m.fullyMarked,
      mixed: m.mixed,
      markedFootage: m.markedFootage,
      cotp: m.cotp,
      cotpNumerator: m.cotpNumerator,
      cotpDenominator: m.cotpDenominator,
      clearRate: m.completed > 0
        ? { value: (m.fullyClear / m.completed) * 100, numerator: m.fullyClear, denominator: m.completed }
        : { value: null, numerator: 0, denominator: 0 },
    };
  }).sort((a, b) => b.ticketCount - a.ticketCount);

  // Group by supervisor
  const bySupMap = new Map();
  for (const ticket of customerTickets) {
    const techInfo = techMap.get(ticket.assigned_tech_id || '');
    const supId = techInfo?.supervisor_id || techInfo?.supervisor_territory_id || 'UNASSIGNED';
    const supName = techInfo?.supervisor_name || techInfo?.supervisor_territory_name || 'Unassigned';
    if (!bySupMap.has(supId)) bySupMap.set(supId, { supId, supName, tickets: [] });
    bySupMap.get(supId).tickets.push(ticket);
  }
  const bySupervisor = Array.from(bySupMap.values()).map(({ supId, supName, tickets: tix }) => {
    const m = summarizeTicketMetrics(tix);
    return {
      supervisorId: supId,
      supervisorName: supName,
      ticketCount: tix.length,
      completed: m.completed,
      fullyClear: m.fullyClear,
      fullyMarked: m.fullyMarked,
      mixed: m.mixed,
      markedFootage: m.markedFootage,
      cotp: m.cotp,
      cotpNumerator: m.cotpNumerator,
      cotpDenominator: m.cotpDenominator,
      clearRate: m.completed > 0
        ? { value: (m.fullyClear / m.completed) * 100, numerator: m.fullyClear, denominator: m.completed }
        : { value: null, numerator: 0, denominator: 0 },
    };
  }).sort((a, b) => b.ticketCount - a.ticketCount);

  // Group by area
  const byAreaMap = new Map();
  for (const ticket of customerTickets) {
    const techInfo = techMap.get(ticket.assigned_tech_id || '');
    const areaId = techInfo?.area_territory_id || ticket.area_territory_id || 'UNASSIGNED';
    const areaName = techInfo?.area_territory_name || 'Unassigned';
    if (!byAreaMap.has(areaId)) byAreaMap.set(areaId, { areaId, areaName, tickets: [] });
    byAreaMap.get(areaId).tickets.push(ticket);
  }
  const byArea = Array.from(byAreaMap.values()).map(({ areaId, areaName, tickets: tix }) => {
    const m = summarizeTicketMetrics(tix);
    return {
      areaId,
      areaName,
      ticketCount: tix.length,
      completed: m.completed,
      fullyClear: m.fullyClear,
      fullyMarked: m.fullyMarked,
      mixed: m.mixed,
      markedFootage: m.markedFootage,
      cotp: m.cotp,
      cotpNumerator: m.cotpNumerator,
      cotpDenominator: m.cotpDenominator,
      clearRate: m.completed > 0
        ? { value: (m.fullyClear / m.completed) * 100, numerator: m.fullyClear, denominator: m.completed }
        : { value: null, numerator: 0, denominator: 0 },
    };
  }).sort((a, b) => b.ticketCount - a.ticketCount);

  // Group by date (YYYY-MM-DD of closed_at or created_at)
  const byDateMap = new Map();
  for (const ticket of customerTickets) {
    const ts = ticket.closed_at || ticket.created_at;
    const date = ts ? new Date(ts).toISOString().slice(0, 10) : 'UNKNOWN';
    if (!byDateMap.has(date)) byDateMap.set(date, []);
    byDateMap.get(date).push(ticket);
  }
  const byDate = Array.from(byDateMap.entries()).map(([date, tix]) => {
    const m = summarizeTicketMetrics(tix);
    return {
      date,
      ticketCount: tix.length,
      completed: m.completed,
      fullyClear: m.fullyClear,
      fullyMarked: m.fullyMarked,
      mixed: m.mixed,
      markedFootage: m.markedFootage,
      cotp: m.cotp,
      cotpNumerator: m.cotpNumerator,
      cotpDenominator: m.cotpDenominator,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));

  // Group by ticket type
  const byTypeMap = new Map();
  for (const ticket of customerTickets) {
    const type = ticket.ticket_type || 'UNKNOWN';
    if (!byTypeMap.has(type)) byTypeMap.set(type, []);
    byTypeMap.get(type).push(ticket);
  }
  const byTicketType = Array.from(byTypeMap.entries()).map(([type, tix]) => {
    const m = summarizeTicketMetrics(tix);
    return {
      ticketType: type,
      ticketCount: tix.length,
      completed: m.completed,
      fullyClear: m.fullyClear,
      fullyMarked: m.fullyMarked,
      mixed: m.mixed,
      markedFootage: m.markedFootage,
      cotp: m.cotp,
      cotpNumerator: m.cotpNumerator,
      cotpDenominator: m.cotpDenominator,
    };
  }).sort((a, b) => b.ticketCount - a.ticketCount);

  return { byTechnician, bySupervisor, byArea, byDate, byTicketType };
}
