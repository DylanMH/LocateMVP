import {
  calculateMarkedFootage,
  classifyTicketOutcome,
  isCompletedOnTime,
  isMarkedTicket,
  summarizeTicketMetrics,
} from '../src/services/analytics/ticketMetrics.js';

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

function ticket(id, customerMarkings, closedAt, dueAt = 2000) {
  return {
    id,
    status: 'CLOSED',
    closed_at: closedAt,
    due_at: dueAt,
    payload_json: JSON.stringify({
      customers: [
        { id: `${id}-clear`, name: 'Clear Utility' },
        { id: `${id}-marked`, name: 'Marked Utility' },
      ],
      customerMarkings,
    }),
  };
}

const fullyClear = ticket('clear', {
  'clear-clear': { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR', footage: '0' },
  'clear-marked': { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR', footage: '0' },
}, 1000);
const fullyMarked = ticket('marked', {
  'marked-clear': { completed: true, status: 'MARKED', result: 'PAINT_AND_FLAG', footage: '120' },
  'marked-marked': { completed: true, status: 'MARKED', result: 'PAINT_ONLY', footage: '80' },
}, 1000);
const mixed = ticket('mixed', {
  'mixed-clear': { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR', footage: '0' },
  'mixed-marked': { completed: true, status: 'MARKED', result: 'FLAG_ONLY', footage: '300' },
}, 1000);
const incomplete = ticket('incomplete', {
  'incomplete-clear': { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR', footage: '0' },
  'incomplete-marked': { completed: false, status: 'MARKED', result: 'PAINT_ONLY', footage: '50' },
}, 1000);

assert(classifyTicketOutcome(fullyClear) === 'FULLY_CLEAR', 'classifies fully clear ticket');
assert(classifyTicketOutcome(fullyMarked) === 'FULLY_MARKED', 'classifies fully marked ticket');
assert(classifyTicketOutcome(mixed) === 'MIXED', 'classifies mixed ticket');
assert(classifyTicketOutcome(incomplete) === 'UNCLASSIFIED', 'does not classify incomplete ticket');
assert(isMarkedTicket(fullyClear) === false, 'fully clear ticket is not marked');
assert(isMarkedTicket(mixed) === true, 'mixed ticket is marked');
assert(calculateMarkedFootage(mixed) === 300, 'calculates marked footage only');
assert(isCompletedOnTime(fullyClear) === true, 'completion at or before due time is on time');
assert(isCompletedOnTime({ ...fullyClear, closed_at: 2001 }) === false, 'completion after due time is late');
assert(isCompletedOnTime({ ...fullyClear, closed_at: null }) === false, 'missing completion time is not eligible');
assert(isCompletedOnTime({ ...fullyClear, due_at: null }) === false, 'missing due time is not eligible');

const summary = summarizeTicketMetrics([
  fullyClear,
  fullyMarked,
  mixed,
  { ...ticket('late', {
    'late-clear': { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR' },
    'late-marked': { completed: true, status: 'NOT_MARKED', result: 'EXCAVATION_SITE_CLEAR' },
  }, 3000), due_at: 2000 },
  { ...incomplete, due_at: null },
]);
assert(summary.completed === 5, 'counts completed tickets by completion timestamp');
assert(summary.fullyClear === 2, 'counts fully clear tickets');
assert(summary.fullyMarked === 1, 'counts fully marked tickets');
assert(summary.mixed === 1, 'counts mixed tickets');
assert(summary.markedTickets === 2, 'counts mixed tickets as marked');
assert(summary.markedFootage === 500, 'sums marked footage');
assert(summary.cotp === 75, 'calculates COTP from eligible completed tickets');
assert(summary.cotpNumerator === 3 && summary.cotpDenominator === 4, 'returns COTP numerator and denominator');

const linkedChild = { ...mixed, id: 'linked-child', root_ticket_id: 'root-ticket', parent_ticket_id: 'root-ticket' };
const linkedSummary = summarizeTicketMetrics([mixed, linkedChild]);
assert(linkedSummary.completed === 2, 'counts linked tickets independently');
assert(linkedSummary.markedFootage === 600, 'does not collapse independent linked-ticket production');

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
