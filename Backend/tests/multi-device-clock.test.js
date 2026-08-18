/**
 * Multi-device clock-in reconciliation tests (Phase 1.5)
 *
 * Verifies the server-authoritative clock state changes:
 *   - Duplicate CLOCK_IN from a second device is refused with ALREADY_CLOCKED_IN
 *   - The timesheet sync endpoint returns the active session for reconciliation
 *   - Idempotent resend of the original CLOCK_IN returns cached OK
 *   - Force CLOCK_IN closes the prior session and succeeds
 *   - The sync endpoint reflects updated session statuses after force
 *
 * Prerequisites:
 *   - Backend on http://localhost:3000  (pnpm dev:backend)
 *
 * Run: node Backend/tests/multi-device-clock.test.js
 */
import { randomUUID } from "node:crypto";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const TEST_USER_ID = `test-mdc-${Date.now()}`;
const SESSION_A = `mdc-session-a-${Date.now()}`;
const SESSION_B = `mdc-session-b-${Date.now()}`;
const REQ_1 = `mdc-req-1-${randomUUID()}`;
const REQ_2 = `mdc-req-2-${randomUUID()}`;
const REQ_FORCE = `mdc-req-force-${randomUUID()}`;

let passed = 0;
let failed = 0;

const section = (label) => console.log(`\n\x1b[1m=== ${label} ===\x1b[0m`);

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (error) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${expected}", got "${actual}"`);
  }
}

async function postEvents(events) {
  const resp = await fetch(`${BACKEND_URL}/api/timesheet/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    "Content-Type": "application/json",
    body: JSON.stringify({ events }),
  });
  assert(resp.ok, `POST /events returned ${resp.status}`);
  return resp.json();
}

async function getSync(userId, lastSyncAt = 0) {
  const resp = await fetch(
    `${BACKEND_URL}/api/timesheet/sync?userId=${userId}&lastSyncAt=${lastSyncAt}`,
  );
  assert(resp.ok, `GET /sync returned ${resp.status}`);
  return resp.json();
}

function makeClockIn(requestId, sessionId, userId, extra = {}) {
  const now = Date.now();
  return {
    type: "CLOCK_EVENT",
    requestId,
    deviceId: `test-${requestId}`,
    seq: 1,
    occurredAt: now,
    payload: {
      sessionId,
      userId,
      eventType: "CLOCK_IN",
      occurredAt: now,
      date: new Date().toISOString().split("T")[0],
      clockInAt: now,
      status: "ACTIVE",
      clockInReason: "locating",
      allocationType: "locating",
      ...extra,
    },
  };
}

async function main() {
  console.log("\n\x1b[1mMulti-Device Clock-In Reconciliation Tests\x1b[0m");
  console.log(`Backend: ${BACKEND_URL}`);
  console.log(`Test user: ${TEST_USER_ID}`);

  section("Duplicate clock-in refusal");

  await test("first CLOCK_IN from Device A succeeds", async () => {
    const result = await postEvents([makeClockIn(REQ_1, SESSION_A, TEST_USER_ID)]);
    assertEqual(result.results[0].status, "OK", "first CLOCK_IN status");
    assertEqual(result.results[0].sessionId, SESSION_A, "first CLOCK_IN sessionId");
  });

  await test("second CLOCK_IN from Device B is refused with ALREADY_CLOCKED_IN", async () => {
    const result = await postEvents([makeClockIn(REQ_2, SESSION_B, TEST_USER_ID)]);
    assertEqual(result.results[0].status, "ERROR", "second CLOCK_IN status");
    assertEqual(result.results[0].error, "ALREADY_CLOCKED_IN", "error code");
    assertEqual(result.results[0].activeSessionId, SESSION_A, "activeSessionId");
  });

  await test("idempotent resend of first CLOCK_IN returns cached OK", async () => {
    const result = await postEvents([makeClockIn(REQ_1, SESSION_A, TEST_USER_ID)]);
    assertEqual(result.results[0].status, "OK", "resend status");
    assertEqual(result.results[0].sessionId, SESSION_A, "resend sessionId");
  });

  section("Timesheet sync endpoint");

  await test("sync endpoint returns the active session", async () => {
    const data = await getSync(TEST_USER_ID);
    assertEqual(data.activeSessionId, SESSION_A, "activeSessionId");
    assert(data.sessions.length >= 1, "should have at least 1 session");
    const sessionA = data.sessions.find((s) => s.id === SESSION_A);
    assert(sessionA, "session A should be in the response");
    assertEqual(sessionA.status, "ACTIVE", "session A status");
  });

  await test("sync endpoint returns clock events for the session", async () => {
    const data = await getSync(TEST_USER_ID);
    const sessionEvents = data.clockEvents.filter((e) => e.session_id === SESSION_A);
    assert(sessionEvents.length >= 1, "should have at least 1 clock event for session A");
    assertEqual(sessionEvents[0].event_type, "CLOCK_IN", "event type");
  });

  section("Force clock-in override");

  await test("force CLOCK_IN from Device B closes prior session and succeeds", async () => {
    const result = await postEvents([
      makeClockIn(REQ_FORCE, SESSION_B, TEST_USER_ID, { force: true }),
    ]);
    assertEqual(result.results[0].status, "OK", "force CLOCK_IN status");
    assertEqual(result.results[0].sessionId, SESSION_B, "force CLOCK_IN sessionId");
  });

  await test("sync endpoint reflects force-closed session A and active session B", async () => {
    const data = await getSync(TEST_USER_ID);
    assertEqual(data.activeSessionId, SESSION_B, "activeSessionId after force");
    const sessionA = data.sessions.find((s) => s.id === SESSION_A);
    const sessionB = data.sessions.find((s) => s.id === SESSION_B);
    assert(sessionA, "session A should still exist");
    assert(sessionB, "session B should exist");
    assertEqual(sessionA.status, "CLOCKED_OUT", "session A status after force");
    assertEqual(sessionB.status, "ACTIVE", "session B status after force");
  });

  section("Summary");

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
