import { initDatabase } from "../src/db/database-sqlite.js";
const db = initDatabase();

const userId = "91e60b79-adfe-4af0-ad81-edbb68fa03b6";

const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(userId);
console.log("User:", JSON.stringify(user, null, 2));

const sessions = db.prepare("SELECT id, user_id, ticket_id, clock_in_at, clock_out_at FROM day_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5").all(userId);
console.log("\nSessions:", JSON.stringify(sessions, null, 2));

const clockEvents = db.prepare("SELECT id, user_id, session_id, type FROM clock_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 5").all(userId);
console.log("\nClock events:", JSON.stringify(clockEvents, null, 2));

// Also check if this ID matches any user by partial match
const partial = db.prepare("SELECT id, name, email, role FROM users WHERE id LIKE '%91e60b79%'").all();
console.log("\nPartial match:", JSON.stringify(partial, null, 2));

process.exit(0);
