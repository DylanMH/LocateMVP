import { db } from "../db/db.js";

export function recomputeTicketStatus(ticketId: string) {
  const rows = db.prepare(`
    SELECT status FROM ticket_members_811 WHERE ticket_id = ?
  `).all(ticketId) as { status: string }[];

  if (rows.length === 0) return;

  const allResponded = rows.every(r => r.status === "RESPONDED");
  const anyResponded = rows.some(r => r.status === "RESPONDED");

  const ticket = db.prepare(`SELECT status, version FROM tickets_811 WHERE id = ?`).get(ticketId) as any;
  if (!ticket) return;

  let next = ticket.status;
  if (allResponded) next = "RESPONDED_ALL";
  else if (anyResponded) next = "RESPONSES_PARTIAL";
  else next = "SENT_TO_MEMBER"; // once pulled by L720 you can flip to this

  if (next !== ticket.status) {
    db.prepare(`
      UPDATE tickets_811
      SET status = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(next, Date.now(), ticketId);
  }
}
