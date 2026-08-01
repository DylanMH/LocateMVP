import Database from "better-sqlite3";
import { join } from "path";

const num = process.argv[2] || "0426-FATE-759346";
const db = new Database(join(process.cwd(), "data", "locate720.db"), {
  readonly: true,
});
const t = db.prepare("SELECT * FROM tickets WHERE ticket_number = ?").get(num);
if (!t) {
  console.log("Ticket not found");
  process.exit(0);
}
console.log(
  `Ticket ${t.ticket_number}  locator_status=${t.locator_status}  status=${t.status}  assigned_tech_id=${t.assigned_tech_id}  updated_at=${new Date(t.updated_at).toLocaleString()}  closed_at=${t.closed_at ? new Date(t.closed_at).toLocaleString() : "—"}`,
);
console.log(`\nEvents:`);
const events = db
  .prepare(
    `SELECT event_type, old_locator_status, new_locator_status, user_id, notes, created_at
     FROM ticket_events WHERE ticket_id = ? ORDER BY created_at ASC`,
  )
  .all(t.id);
for (const e of events) {
  console.log(
    `  ${new Date(e.created_at).toLocaleString()}  ${e.event_type.padEnd(20)}  ${(e.old_locator_status || "—").padEnd(8)} → ${(e.new_locator_status || "—").padEnd(8)}  by=${e.user_id || "—"}  ${e.notes || ""}`,
  );
}
