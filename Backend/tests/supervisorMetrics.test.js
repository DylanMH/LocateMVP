import { computePerTechMetrics } from '../src/services/analytics/supervisorMetrics.js';

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

// Build a mock ticket
function buildTicket(id, techId, closedAt, dueAt, marking) {
  return {
    id,
    assigned_tech_id: techId,
    closed_at: closedAt,
    due_at: dueAt,
    locator_status: 'CLOSED',
    ticket_type: 'NORMAL',
    payload_json: JSON.stringify({
      customers: [{ id: `c-${id}` }],
      customerMarkings: { [`c-${id}`]: marking },
    }),
  };
}

// Mock DB that returns tickets for specific tech IDs
function buildMockDb(ticketsByTech, openByTech, overdueByTech, workedMsByTech) {
  return {
    prepare: (sql) => {
      // Match queries by SQL content
      if (sql.includes('SELECT id, name, email, role FROM users WHERE id = ?')) {
        return {
          get: (techId) => ({ id: techId, name: `Tech ${techId}`, email: `${techId}@test.com`, role: 'TECH' }),
        };
      }
      if (sql.includes('SELECT * FROM tickets') && sql.includes('closed_at IS NOT NULL')) {
        return {
          all: (techId, startMs, endMs) => ticketsByTech[techId] || [],
        };
      }
      if (sql.includes('COUNT(*) as c FROM tickets') && sql.includes("locator_status NOT IN ('CLOSED','UNABLE')")) {
        return {
          get: (techId) => ({ c: openByTech[techId] || 0 }),
        };
      }
      if (sql.includes('SELECT due_at FROM tickets') && sql.includes('due_at IS NOT NULL')) {
        return {
          all: (techId) => [],
        };
      }
      if (sql.includes('COALESCE(SUM') && sql.includes('day_sessions')) {
        return {
          get: (...args) => {
            const techId = args[4]; // user_id parameter position
            return { worked_ms: workedMsByTech[techId] || 0 };
          },
        };
      }
      return { all: () => [], get: () => ({}) };
    },
  };
}

const tickets = [
  buildTicket('t1', 'tech-1', 1000, 2000, { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR' }),
  buildTicket('t2', 'tech-1', 1000, 2000, { completed: true, status: 'MARKED', result: 'PAINT_AND_FLAG', footage: '100' }),
  buildTicket('t3', 'tech-2', 3000, 2000, { completed: true, status: 'MARKED', result: 'PAINT_ONLY', footage: '50' }),
];

const db = buildMockDb(
  { 'tech-1': [tickets[0], tickets[1]], 'tech-2': [tickets[2]] },
  { 'tech-1': 2, 'tech-2': 1 },
  {},
  { 'tech-1': 3600000, 'tech-2': 1800000 }, // 1hr, 30min
);

const results = computePerTechMetrics(db, ['tech-1', 'tech-2'], 0, 4000);

assert(results.length === 2, 'returns one row per tech');
assert(results[0].techId === 'tech-1', 'first row is tech-1');
assert(results[0].completed === 2, 'tech-1 has 2 completed tickets');
assert(results[0].fullyClear === 1, 'tech-1 has 1 fully clear');
assert(results[0].markedTickets === 1, 'tech-1 has 1 marked ticket');
assert(results[0].markedFootage === 100, 'tech-1 has 100ft marked footage');
assert(results[0].openBacklog === 2, 'tech-1 has 2 open tickets');
assert(results[0].workedMs === 3600000, 'tech-1 worked 1 hour');
assert(results[0].ticketsPerHour === 2, 'tech-1 has 2 tickets/hour');
assert(results[1].techId === 'tech-2', 'second row is tech-2');
assert(results[1].completed === 1, 'tech-2 has 1 completed ticket');
assert(results[1].cotp === 0, 'tech-2 has 0% COTP (late ticket)');

const empty = computePerTechMetrics(db, [], 0, 4000);
assert(empty.length === 0, 'handles empty tech list');

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
