/**
 * Status Machine Validation Tests
 * 
 * Run with: node src/validation/tests/statusMachine.test.js
 */

import { validateStatusTransition, validateStatusPayload, LocatorStatus } from '../statusMachine.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('\n=== Status Machine Validation Tests ===\n');

test('Valid transition: ASSIGNED -> ENROUTE', () => {
  const result = validateStatusTransition(LocatorStatus.ASSIGNED, LocatorStatus.ENROUTE);
  assert(result.valid === true, 'Should be valid');
});

test('Valid transition: ENROUTE -> ONSITE', () => {
  const result = validateStatusTransition(LocatorStatus.ENROUTE, LocatorStatus.ONSITE);
  assert(result.valid === true, 'Should be valid');
});

test('Valid transition: ONSITE -> PAUSED', () => {
  const result = validateStatusTransition(LocatorStatus.ONSITE, LocatorStatus.PAUSED);
  assert(result.valid === true, 'Should be valid');
});

test('Valid transition: PAUSED -> ONSITE', () => {
  const result = validateStatusTransition(LocatorStatus.PAUSED, LocatorStatus.ONSITE);
  assert(result.valid === true, 'Should be valid');
});

test('Valid transition: ONSITE -> CLOSED', () => {
  const result = validateStatusTransition(LocatorStatus.ONSITE, LocatorStatus.CLOSED);
  assert(result.valid === true, 'Should be valid');
});

test('Invalid transition: ASSIGNED -> CLOSED', () => {
  const result = validateStatusTransition(LocatorStatus.ASSIGNED, LocatorStatus.CLOSED);
  assert(result.valid === false, 'Should be invalid');
  assert(result.error.includes('Invalid transition'), 'Should have error message');
});

test('Invalid transition: CLOSED -> ONSITE', () => {
  const result = validateStatusTransition(LocatorStatus.CLOSED, LocatorStatus.ONSITE);
  assert(result.valid === false, 'Should be invalid');
  assert(result.error.includes('Invalid transition'), 'Should have error message');
});

test('Invalid transition: PAUSED -> CLOSED', () => {
  const result = validateStatusTransition(LocatorStatus.PAUSED, LocatorStatus.CLOSED);
  assert(result.valid === false, 'Should be invalid');
});

test('Same status is valid', () => {
  const result = validateStatusTransition(LocatorStatus.ONSITE, LocatorStatus.ONSITE);
  assert(result.valid === true, 'Should be valid');
});

test('Missing current status', () => {
  const result = validateStatusTransition(null, LocatorStatus.ENROUTE);
  assert(result.valid === false, 'Should be invalid');
  assert(result.error.includes('required'), 'Should have error message');
});

test('Invalid status value', () => {
  const result = validateStatusTransition('INVALID_STATUS', LocatorStatus.ENROUTE);
  assert(result.valid === false, 'Should be invalid');
  assert(result.error.includes('Invalid current status'), 'Should have error message');
});

test('ENROUTE payload validation - valid', () => {
  const result = validateStatusPayload(LocatorStatus.ENROUTE, {
    enrouteStartedAt: Date.now(),
  });
  assert(result.valid === true, 'Should be valid');
});

test('ENROUTE payload validation - missing field', () => {
  const result = validateStatusPayload(LocatorStatus.ENROUTE, {});
  assert(result.valid === false, 'Should be invalid');
  assert(result.error.includes('enrouteStartedAt'), 'Should mention missing field');
});

test('ONSITE payload validation - valid', () => {
  const result = validateStatusPayload(LocatorStatus.ONSITE, {
    onsiteStartedAt: Date.now(),
  });
  assert(result.valid === true, 'Should be valid');
});

test('CLOSED payload validation - valid', () => {
  const result = validateStatusPayload(LocatorStatus.CLOSED, {
    onsiteStartedAt: Date.now(),
    closedAt: Date.now(),
    customerMarkings: [],
  });
  assert(result.valid === true, 'Should be valid');
});

test('CLOSED payload validation - missing fields', () => {
  const result = validateStatusPayload(LocatorStatus.CLOSED, {
    onsiteStartedAt: Date.now(),
  });
  assert(result.valid === false, 'Should be invalid');
  assert(result.error.includes('closedAt'), 'Should mention missing field');
});

console.log(`\n=== Results ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}\n`);

process.exit(failed > 0 ? 1 : 0);
