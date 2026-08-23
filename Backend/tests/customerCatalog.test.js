import { initDatabase } from '../src/db/database-sqlite.js';
import { resolveCustomerFrom811 } from '../src/services/customerService.js';

const db = initDatabase();
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

const count = db.prepare('SELECT COUNT(*) AS count FROM customers WHERE active = 1').get().count;
assert(count === 18, 'seeds all 18 synthetic customers');

const byCode = resolveCustomerFrom811(db, {
  utilityType: 'FIBER',
  memberCode: 'BSF',
  companyName: 'Unknown name',
});
assert(byCode?.id === 'customer-bsf', 'resolves catalog customer by code');

const byName = resolveCustomerFrom811(db, {
  utilityType: 'GAS',
  memberCode: 'UNKNOWN',
  companyName: 'Texas Prairie Gas',
});
assert(byName?.code === 'TPG', 'resolves catalog customer by name fallback');

const unknown = resolveCustomerFrom811(db, {
  utilityType: 'FIBER',
  memberCode: 'UNKNOWN',
  companyName: 'Unknown Utility',
});
assert(unknown === null, 'unknown customer remains unresolved');

const duplicateCodes = db.prepare(
  'SELECT code FROM customers GROUP BY code HAVING COUNT(*) > 1',
).all();
assert(duplicateCodes.length === 0, 'catalog codes remain unique');

db.close();
console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
