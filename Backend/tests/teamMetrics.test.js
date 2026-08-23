import { computeTeamMetrics, emptyTeamMetrics } from '../src/services/analytics/teamMetrics.js';

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

const tickets = [
  {
    id: 'clear-ticket',
    assigned_tech_id: 'tech-1',
    closed_at: 1000,
    due_at: 2000,
    payload_json: JSON.stringify({
      customers: [{ id: 'clear-customer' }],
      customerMarkings: {
        'clear-customer': { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR' },
      },
    }),
  },
  {
    id: 'marked-ticket',
    assigned_tech_id: 'tech-2',
    closed_at: 1000,
    due_at: 2000,
    payload_json: JSON.stringify({
      customers: [{ id: 'marked-customer' }],
      customerMarkings: {
        'marked-customer': { completed: true, status: 'MARKED', result: 'PAINT_AND_FLAG', footage: '100' },
      },
    }),
  },
  {
    id: 'late-ticket',
    assigned_tech_id: 'tech-2',
    closed_at: 3000,
    due_at: 2000,
    payload_json: JSON.stringify({
      customers: [{ id: 'late-customer' }],
      customerMarkings: {
        'late-customer': { completed: true, status: 'MARKED', result: 'PAINT_ONLY', footage: '50' },
      },
    }),
  },
];

const db = {
  prepare: () => ({
    all: () => tickets,
  }),
};

const result = computeTeamMetrics(db, ['tech-1', 'tech-2'], 0, 4000);
assert(result.completed === 3, 'counts completed tickets across technicians');
assert(result.fullyClear === 1, 'counts fully clear tickets');
assert(result.fullyMarked === 2, 'counts fully marked tickets');
assert(result.markedTickets === 2, 'counts marked tickets');
assert(result.markedFootage === 150, 'sums marked footage');
assert(result.cotp === 2 / 3 * 100, 'calculates team COTP');
assert(result.cotpNumerator === 2 && result.cotpDenominator === 3, 'returns team COTP denominator');
assert(result.techCount === 2, 'reports scoped technician count');

const empty = computeTeamMetrics(db, [], 0, 4000);
assert(JSON.stringify(empty) === JSON.stringify(emptyTeamMetrics()), 'handles an empty team');

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
