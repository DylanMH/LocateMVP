import { summarizeCustomerBreakdowns } from '../src/services/analytics/customerMetrics.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

const customer = {
  id: 'customer-bsf',
  display_name: 'BlueSpan Fiber',
  utility_type: 'FIBER',
};

function buildTicket(id, techId, closedAt, dueAt, type, marking) {
  return {
    id,
    assigned_tech_id: techId,
    closed_at: closedAt,
    due_at: dueAt,
    created_at: closedAt || Date.now(),
    locator_status: 'CLOSED',
    ticket_type: type || 'NORMAL',
    area_territory_id: 'terr-area-etx',
    payload_json: JSON.stringify({
      customers: [{ id: `c-${id}`, name: 'BlueSpan Fiber', utility: 'FIBER' }],
      customerMarkings: { [`c-${id}`]: marking },
    }),
  };
}

const tickets = [
  buildTicket('t1', 'tech-1', 1000, 2000, 'NORMAL', { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR' }),
  buildTicket('t2', 'tech-1', 1000, 2000, 'EMERGENCY', { completed: true, status: 'MARKED', result: 'PAINT_AND_FLAG', footage: '500' }),
  buildTicket('t3', 'tech-2', Date.now(), 2000, 'NORMAL', { completed: true, status: 'MARKED', result: 'PAINT_ONLY', footage: '300' }),
];

// Mock DB for tech lookups
const mockDb = {
  prepare: (sql) => {
    if (sql.includes('SELECT u.id, u.name, u.supervisor_id')) {
      return {
        all: () => [
          { id: 'tech-1', name: 'Alice', supervisor_id: 'sup-1', supervisor_name: 'Bob', supervisor_territory_id: 'terr-sup-1', supervisor_territory_name: 'ETX5301', area_territory_id: 'terr-area-etx', area_territory_name: 'East Texas' },
          { id: 'tech-2', name: 'Charlie', supervisor_id: 'sup-1', supervisor_name: 'Bob', supervisor_territory_id: 'terr-sup-1', supervisor_territory_name: 'ETX5301', area_territory_id: 'terr-area-etx', area_territory_name: 'East Texas' },
        ],
      };
    }
    return { all: () => [], get: () => ({}) };
  },
};

const breakdowns = summarizeCustomerBreakdowns(tickets, customer, mockDb);

// By technician
assert(breakdowns.byTechnician.length === 2, 'breaks down by 2 technicians');
assert(breakdowns.byTechnician[0].techId === 'tech-1', 'first tech row is tech-1');
assert(breakdowns.byTechnician[0].ticketCount === 2, 'tech-1 has 2 tickets');
assert(breakdowns.byTechnician[0].completed === 2, 'tech-1 has 2 completed');
assert(breakdowns.byTechnician[0].markedFootage === 500, 'tech-1 has 500ft marked footage');
assert(breakdowns.byTechnician[1].techId === 'tech-2', 'second tech row is tech-2');
assert(breakdowns.byTechnician[1].ticketCount === 1, 'tech-2 has 1 ticket');

// By supervisor
assert(breakdowns.bySupervisor.length === 1, 'breaks down by 1 supervisor');
assert(breakdowns.bySupervisor[0].supervisorId === 'sup-1', 'supervisor is sup-1');
assert(breakdowns.bySupervisor[0].ticketCount === 3, 'supervisor has 3 total tickets');

// By area
assert(breakdowns.byArea.length === 1, 'breaks down by 1 area');
assert(breakdowns.byArea[0].areaId === 'terr-area-etx', 'area is terr-area-etx');

// By date
assert(breakdowns.byDate.length === 2, 'breaks down by 2 dates');
assert(breakdowns.byDate[0].date !== undefined, 'date rows have date field');

// By ticket type
assert(breakdowns.byTicketType.length === 2, 'breaks down by 2 ticket types');
const normalType = breakdowns.byTicketType.find(r => r.ticketType === 'NORMAL');
const emergencyType = breakdowns.byTicketType.find(r => r.ticketType === 'EMERGENCY');
assert(normalType && normalType.ticketCount === 2, 'has 2 NORMAL tickets');
assert(emergencyType && emergencyType.ticketCount === 1, 'has 1 EMERGENCY ticket');

// Empty case
const emptyBreakdowns = summarizeCustomerBreakdowns([], customer, mockDb);
assert(emptyBreakdowns.byTechnician.length === 0, 'handles empty tickets for technician breakdown');
assert(emptyBreakdowns.bySupervisor.length === 0, 'handles empty tickets for supervisor breakdown');
assert(emptyBreakdowns.byDate.length === 0, 'handles empty tickets for date breakdown');

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
