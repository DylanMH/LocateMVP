import { runDataQualityChecks } from '../src/services/dataQualityService.js';

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

const emptyDb = { prepare: () => ({ all: () => [] }) };
const emptyResult = runDataQualityChecks(emptyDb);
assert(emptyResult.issueCount === 0, 'returns zero issues for a clean database');
assert(Object.keys(emptyResult.byType).length === 0, 'returns empty issue counts for a clean database');

const rows = [
  { id: 'ticket-1', ticket_number: 'T-1', status: 'CLOSED', locator_status: 'CLOSED', assigned_tech_id: null, payload_json: JSON.stringify({ customers: [{ id: 'customer-1' }], customerMarkings: {} }) },
  { id: 'ticket-2', ticket_number: 'T-2', status: 'OPEN', locator_status: 'ASSIGNED', assigned_tech_id: null, payload_json: '{}' },
];
let queryIndex = 0;
const fakeDb = {
  prepare: () => ({
    all: () => {
      queryIndex += 1;
      if (queryIndex === 1) return rows;
      return [];
    },
  }),
};
const result = runDataQualityChecks(fakeDb);
assert(result.issueCount === 3, 'detects closed timestamp, customer outcome, and unassigned ticket issues');
assert(result.byType.COMPLETED_MISSING_CLOSED_AT === 1, 'counts missing closed timestamp');
assert(result.byType.COMPLETED_CUSTOMER_MISSING_STATUS === 1, 'counts missing customer outcome');
assert(result.byType.TICKET_WITHOUT_TECH === 1, 'counts active ticket without technician');

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
