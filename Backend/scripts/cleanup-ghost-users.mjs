/**
 * Clean up ghost mobile users that were auto-created by the timesheet
 * ensureUserExists() helper when the mobile app sent WatermelonDB local IDs
 * instead of backend user IDs.
 *
 * Run: node scripts/cleanup-ghost-users.mjs
 */
import { initDatabase } from "../src/db/database-sqlite.js";
const db = initDatabase();

// Find ghost users (auto-created placeholder users)
const ghosts = db.prepare(`
  SELECT id, name, email, role
  FROM users
  WHERE email LIKE '%@mobile.local'
     OR name LIKE 'Mobile User %'
`).all();

console.log(`[cleanup] Found ${ghosts.length} ghost user(s):`);
for (const g of ghosts) {
  console.log(`  - ${g.id} (${g.name}, ${g.email}, ${g.role})`);

  // Count dependent records
  const sessions = db.prepare("SELECT COUNT(*) as c FROM day_sessions WHERE user_id = ?").get(g.id);
  const clockEvents = db.prepare("SELECT COUNT(*) as c FROM clock_events WHERE user_id = ?").get(g.id);
  const breakSegments = db.prepare("SELECT COUNT(*) as c FROM break_segments WHERE user_id = ?").get(g.id);
  console.log(`    sessions: ${sessions.c}, clock_events: ${clockEvents.c}, break_segments: ${breakSegments.c}`);

  // Delete dependent records first (FK constraints)
  db.prepare("DELETE FROM break_segments WHERE user_id = ?").run(g.id);
  db.prepare("DELETE FROM clock_events WHERE user_id = ?").run(g.id);
  db.prepare("DELETE FROM day_sessions WHERE user_id = ?").run(g.id);
  db.prepare("DELETE FROM users WHERE id = ?").run(g.id);
  console.log(`    [deleted]`);
}

console.log("[cleanup] Done");
process.exit(0);
