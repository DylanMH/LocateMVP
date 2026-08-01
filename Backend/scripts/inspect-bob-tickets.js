import Database from "better-sqlite3";
import { join } from "path";

const db = new Database(join(process.cwd(), "data", "locate720.db"), {
  readonly: true,
});

const BOB = "user-bob-123";

const tickets = db
  .prepare(
    `SELECT id, ticket_number, locator_status, assigned_tech_id, version,
            created_at, updated_at
     FROM tickets
     WHERE assigned_tech_id = ?
     ORDER BY updated_at DESC`,
  )
  .all(BOB);

console.log(`Tickets assigned to ${BOB}: ${tickets.length}`);
for (const t of tickets) {
  console.log(
    `- ${t.ticket_number}  ${t.locator_status.padEnd(8)}  v${t.version}  updated=${new Date(t.updated_at).toLocaleString()}`,
  );
}

const recentAssigns = db
  .prepare(
    `SELECT te.created_at, te.payload_json, t.ticket_number
     FROM ticket_events te JOIN tickets t ON t.id = te.ticket_id
     WHERE te.event_type = 'OPS_ASSIGN'
     ORDER BY te.created_at DESC LIMIT 10`,
  )
  .all();

console.log(`\nRecent OPS_ASSIGN events:`);
for (const e of recentAssigns) {
  let p;
  try { p = JSON.parse(e.payload_json); } catch { p = {}; }
  console.log(
    `- ${new Date(e.created_at).toLocaleString()}  ${e.ticket_number}  ${p.previousTechId || "—"} → ${p.newTechId || "—"}`,
  );
}
