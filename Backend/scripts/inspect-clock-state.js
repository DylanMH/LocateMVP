import Database from "better-sqlite3";
import { join } from "path";

const db = new Database(join(process.cwd(), "data", "locate720.db"), {
  readonly: true,
});

const activeSessions = db
  .prepare(
    `SELECT ds.id, ds.user_id, u.name, ds.date, ds.clock_in_at, ds.clock_out_at, ds.status,
            (SELECT COUNT(*) FROM clock_events ce WHERE ce.session_id = ds.id AND ce.event_type = 'CLOCK_OUT') as has_clock_out
     FROM day_sessions ds
     LEFT JOIN users u ON u.id = ds.user_id
     WHERE ds.status = 'ACTIVE'
     ORDER BY ds.clock_in_at DESC`,
  )
  .all();

console.log(`\n=== ACTIVE day_sessions (${activeSessions.length}) ===`);
for (const s of activeSessions) {
  const ageHours = ((Date.now() - s.clock_in_at) / 3600000).toFixed(1);
  console.log(
    `- ${s.name || s.user_id}  date=${s.date}  clock_in=${new Date(s.clock_in_at).toLocaleString()}  age=${ageHours}h  has_clock_out_event=${s.has_clock_out}  session_id=${s.id.slice(0, 8)}`,
  );
}

const recentEvents = db
  .prepare(
    `SELECT ce.*, u.name
     FROM clock_events ce LEFT JOIN users u ON u.id = ce.user_id
     ORDER BY ce.occurred_at DESC LIMIT 20`,
  )
  .all();

console.log(`\n=== Recent clock_events (last 20) ===`);
for (const e of recentEvents) {
  console.log(
    `- ${new Date(e.occurred_at).toLocaleString()}  ${e.event_type.padEnd(15)}  ${e.name || e.user_id}  session=${e.session_id.slice(0, 8)}`,
  );
}
