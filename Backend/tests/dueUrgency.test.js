/**
 * Tests for due urgency computation.
 * Run: node tests/dueUrgency.test.js
 */
import { computeDueUrgency, DUE_URGENCY } from '../src/utils/dueUrgency.js';

const NOW = 1700000000000; // Fixed timestamp for deterministic tests

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

// ── Null/invalid inputs ────────────────────────────────────
assert(computeDueUrgency(null, NOW) === null, 'null dueAt returns null');
assert(computeDueUrgency(undefined, NOW) === null, 'undefined dueAt returns null');
assert(computeDueUrgency(NaN, NOW) === null, 'NaN dueAt returns null');
assert(computeDueUrgency('not a number', NOW) === null, 'string dueAt returns null');

// ── OVERDUE ────────────────────────────────────────────────
assert(computeDueUrgency(NOW - 1, NOW) === DUE_URGENCY.OVERDUE, '1ms ago is OVERDUE');
assert(computeDueUrgency(NOW - 1000, NOW) === DUE_URGENCY.OVERDUE, '1s ago is OVERDUE');
assert(computeDueUrgency(NOW - 3600000, NOW) === DUE_URGENCY.OVERDUE, '1h ago is OVERDUE');
assert(computeDueUrgency(NOW, NOW) === DUE_URGENCY.OVERDUE, 'exactly now is OVERDUE');

// ── DUE_WITHIN_2_HOURS ─────────────────────────────────────
assert(computeDueUrgency(NOW + 1, NOW) === DUE_URGENCY.DUE_WITHIN_2_HOURS, '1ms from now is DUE_WITHIN_2_HOURS');
assert(computeDueUrgency(NOW + 3600000, NOW) === DUE_URGENCY.DUE_WITHIN_2_HOURS, '1h from now is DUE_WITHIN_2_HOURS');
assert(computeDueUrgency(NOW + 7200000, NOW) === DUE_URGENCY.DUE_WITHIN_2_HOURS, 'exactly 2h from now is DUE_WITHIN_2_HOURS');

// ── DUE_TODAY ──────────────────────────────────────────────
// Use a timestamp later today (but > 2h away)
const laterToday = new Date(NOW);
laterToday.setHours(23, 0, 0, 0);
if (laterToday.getTime() > NOW + 7200000) {
  assert(computeDueUrgency(laterToday.getTime(), NOW) === DUE_URGENCY.DUE_TODAY, '11pm today (> 2h away) is DUE_TODAY');
}

// ── DUE_WITHIN_72_HOURS ────────────────────────────────────
const tomorrow = new Date(NOW);
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(12, 0, 0, 0);
assert(computeDueUrgency(tomorrow.getTime(), NOW) === DUE_URGENCY.DUE_WITHIN_72_HOURS, 'tomorrow noon is DUE_WITHIN_72_HOURS');

const twoDays = new Date(NOW);
twoDays.setDate(twoDays.getDate() + 2);
twoDays.setHours(12, 0, 0, 0);
assert(computeDueUrgency(twoDays.getTime(), NOW) === DUE_URGENCY.DUE_WITHIN_72_HOURS, '2 days from now is DUE_WITHIN_72_HOURS');

// ── FUTURE ─────────────────────────────────────────────────
const fourDays = new Date(NOW);
fourDays.setDate(fourDays.getDate() + 4);
assert(computeDueUrgency(fourDays.getTime(), NOW) === DUE_URGENCY.FUTURE, '4 days from now is FUTURE');

const week = new Date(NOW);
week.setDate(week.getDate() + 7);
assert(computeDueUrgency(week.getTime(), NOW) === DUE_URGENCY.FUTURE, '1 week from now is FUTURE');

// ── Default now parameter ──────────────────────────────────
const result = computeDueUrgency(Date.now() - 1000);
assert(result === DUE_URGENCY.OVERDUE, 'default now parameter works (1s ago is OVERDUE)');

// ── Results ────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
