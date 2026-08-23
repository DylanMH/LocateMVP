import { summarizeCustomerMetrics } from '../src/services/analytics/customerMetrics.js';

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

function buildTicket(id, closedAt, dueAt, marking) {
  return {
    id,
    closed_at: closedAt,
    due_at: dueAt,
    assigned_tech_id: 'tech-1',
    payload_json: JSON.stringify({
      customers: [{ id: `payload-${id}`, name: 'BlueSpan Fiber', utility: 'FIBER' }],
      customerMarkings: { [`payload-${id}`]: marking },
    }),
  };
}

const metrics = summarizeCustomerMetrics([
  buildTicket('clear', 1000, 2000, { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR' }),
  buildTicket('marked', 1000, 2000, { completed: true, status: 'MARKED', result: 'PAINT_AND_FLAG', footage: '500' }),
  buildTicket('late', 3000, 2000, { completed: true, status: 'MARKED', result: 'PAINT_ONLY', footage: '300' }),
], customer);

assert(metrics.ticketCount === 3, 'counts matching customer tickets');
assert(metrics.fullyClear === 1, 'counts clear customer tickets');
assert(metrics.markedTickets === 2, 'counts marked customer tickets');
assert(metrics.markedFootage === 800, 'sums customer marked footage');
assert(metrics.overdueCompletions === 1, 'counts overdue customer completions');
assert(metrics.averageFootagePerMarkedTicket === 400, 'calculates average marked footage');
assert(summarizeCustomerMetrics([], customer).cotp === null, 'returns null COTP for empty customer range');

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
