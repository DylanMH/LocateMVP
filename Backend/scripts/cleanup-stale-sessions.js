/**
 * Reconciles backend day_sessions with mobile reality.
 *
 * Closes any ACTIVE day_session older than --max-age-hours (default 12)
 * that has no corresponding CLOCK_OUT event. Writes a synthetic CLOCK_OUT
 * with reason='BACKEND_RECONCILE' so reports and audits show why.
 *
 * Usage:
 *   node scripts/cleanup-stale-sessions.js              # dry run
 *   node scripts/cleanup-stale-sessions.js --apply      # actually close them
 *   node scripts/cleanup-stale-sessions.js --apply --max-age-hours=6
 */

import Database from "better-sqlite3";
import { join } from "path";
import { randomUUID } from "crypto";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const maxAgeArg = process.argv.find((a) => a.startsWith("--max-age-hours="));
const maxAgeHours = maxAgeArg ? Number(maxAgeArg.split("=")[1]) : 12;
const cutoffMs = Date.now() - maxAgeHours * 3600000;

const db = new Database(join(process.cwd(), "data", "locate720.db"));

const stale = db
  .prepare(
    `SELECT ds.id, ds.user_id, ds.date, ds.clock_in_at, u.name
     FROM day_sessions ds
     LEFT JOIN users u ON u.id = ds.user_id
     WHERE ds.status = 'ACTIVE'
       AND ds.clock_in_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM clock_events ce
         WHERE ce.session_id = ds.id AND ce.event_type = 'CLOCK_OUT'
       )
     ORDER BY ds.clock_in_at ASC`,
  )
  .all(cutoffMs);

console.log(
  `Found ${stale.length} stale ACTIVE sessions older than ${maxAgeHours}h (cutoff ${new Date(cutoffMs).toLocaleString()})`,
);
for (const s of stale) {
  const age = ((Date.now() - s.clock_in_at) / 3600000).toFixed(1);
  console.log(
    `  - ${s.name || s.user_id}  date=${s.date}  age=${age}h  session=${s.id}`,
  );
}

if (!apply) {
  console.log("\nDry run. Pass --apply to close these sessions.");
  process.exit(0);
}

const closeSession = db.prepare(`
  UPDATE day_sessions
  SET status = 'CLOCKED_OUT', clock_out_at = ?, updated_at = ?
  WHERE id = ?
`);
const insertEvent = db.prepare(`
  INSERT INTO clock_events (
    id, request_id, session_id, user_id, event_type,
    occurred_at, reason, session_status, created_at
  ) VALUES (?, ?, ?, ?, 'CLOCK_OUT', ?, 'BACKEND_RECONCILE', 'CLOCKED_OUT', ?)
`);

const tx = db.transaction(() => {
  const now = Date.now();
  for (const s of stale) {
    const closedAt = s.clock_in_at + 1000;
    closeSession.run(closedAt, now, s.id);
    const id = randomUUID();
    insertEvent.run(id, id, s.id, s.user_id, closedAt, now);
  }
});

tx();
console.log(`\nClosed ${stale.length} session(s).`);
