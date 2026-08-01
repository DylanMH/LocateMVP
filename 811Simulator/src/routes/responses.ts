import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "../db/db.js";
import { recomputeTicketStatus } from "../domain/statusLogic.js";

export async function responsesRoutes(app: FastifyInstance) {
  app.post("/api/811/tickets/:ticketId/responses", async (req, reply) => {
    const { ticketId } = req.params as any;

    const bodySchema = z.object({
      responses: z.array(z.object({
        memberCode: z.string().min(1).default("USIC"),
        utilityType: z.string().min(1),
        responseCode: z.string().min(1), // CLEAR, NOT_MARKED, UNABLE, NO_FACILITIES, etc.
        respondedAt: z.number().int().optional(),
        notes: z.string().optional()
      })).min(1),
      closeTicket: z.boolean().optional()
    });

    const body = bodySchema.parse(req.body ?? {});
    const ticket = db.prepare(`SELECT id FROM tickets_811 WHERE id = ?`).get(ticketId) as any;
    if (!ticket) return reply.code(404).send({ error: "Ticket not found" });

    const updMember = db.prepare(`
      UPDATE ticket_members_811
      SET status = 'RESPONDED',
          response_code = @response_code,
          responded_at = @responded_at,
          notes = @notes
      WHERE ticket_id = @ticket_id
        AND member_code = @member_code
        AND utility_type = @utility_type
    `);

    const bumpTicket = db.prepare(`
      UPDATE tickets_811
      SET updated_at = ?, version = version + 1
      WHERE id = ?
    `);

    const insertEvent = db.prepare(`
      INSERT INTO ticket_event_log_811 (id, ticket_id, type, occurred_at, payload_json)
      VALUES (@id, @ticket_id, @type, @occurred_at, @payload_json)
    `);

    const now = Date.now();

    const tx = db.transaction(() => {
      for (const r of body.responses) {
        updMember.run({
          ticket_id: ticketId,
          member_code: r.memberCode,
          utility_type: r.utilityType,
          response_code: r.responseCode,
          responded_at: r.respondedAt ?? now,
          notes: r.notes ?? null
        });
      }

      bumpTicket.run(now, ticketId);

      insertEvent.run({
        id: crypto.randomUUID(),
        ticket_id: ticketId,
        type: "MEMBER_RESPONDED",
        occurred_at: now,
        payload_json: JSON.stringify(body),
      });

      recomputeTicketStatus(ticketId);

      if (body.closeTicket) {
        db.prepare(`
          UPDATE tickets_811
          SET status = 'CLOSED', updated_at = ?, version = version + 1
          WHERE id = ?
        `).run(Date.now(), ticketId);

        insertEvent.run({
          id: crypto.randomUUID(),
          ticket_id: ticketId,
          type: "TICKET_CLOSED",
          occurred_at: Date.now(),
          payload_json: JSON.stringify({ closeTicket: true }),
        });
      }
    });

    tx();

    return reply.send({ ok: true });
  });
}
