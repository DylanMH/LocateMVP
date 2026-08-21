import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "../db/db.js";
import {
  generateTickets,
  createLinkedTicket,
  getTicketChain,
  LINKED_TICKET_TYPES,
} from "../domain/generator.js";
import { notifyL720BackendOf811Change } from "../services/dispatchNotifier.js";
import { AREAS, type AreaId } from "../domain/areas.js";

const AREA_IDS = AREAS.map((a) => a.id) as [AreaId, ...AreaId[]];

function shapeTicketForApi(t: any) {
  let payload: any = {};
  try { payload = JSON.parse(t.payload_json || "{}"); } catch { /* ignore */ }
  return {
    id: t.id,
    ticketNumber: t.ticket_number,
    ticketType: t.ticket_type,
    status: t.status,
    version: t.version,
    areaId: t.area_id,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    dueAt: t.due_at,
    originalDueAt: t.original_due_at,
    address: `${t.address_line1}, ${t.city}, ${t.state} ${t.zip}`,
    lat: t.lat,
    lng: t.lng,
    workType: t.work_type,
    markingInstructions: t.marking_instructions,
    // Lineage fields (see docs/linked-tickets-architecture.md).
    rootTicketId: t.root_ticket_id,
    parentTicketId: t.parent_ticket_id,
    sequenceNumber: t.sequence_number,
    externalRootNumber: t.external_root_number,
    payloadJson: t.payload_json,
    payload,
  };
}

export async function ticketsRoutes(app: FastifyInstance) {
  app.post("/api/811/generate", async (req, reply) => {
    const bodySchema = z.object({
      areaId: z.enum(AREA_IDS).optional(),
      count: z.number().int().min(1).max(300).default(10),
    });
    const body = bodySchema.parse(req.body ?? {});
    const triggerAt = Date.now() - 1000;
    const ids = generateTickets({ areaId: body.areaId, count: body.count });
    await notifyL720BackendOf811Change({ since: triggerAt });
    return reply.send({ created: ids.length, ticketIds: ids });
  });

  // Create a linked ticket under an existing root (or any member of a chain).
  // Linked tickets are brand-new operational tickets with their own id/number/status;
  // linkage is purely historical. See docs/linked-tickets-architecture.md.
  app.post("/api/811/tickets/:rootId/linked", async (req, reply) => {
    const paramsSchema = z.object({ rootId: z.string().min(1) });
    const bodySchema = z.object({
      type: z.enum(LINKED_TICKET_TYPES as unknown as [string, ...string[]]),
      overrides: z
        .object({
          markingInstructions: z.string().optional(),
          dueAt: z.number().int().optional(),
          additionalNotes: z.string().optional(),
          urgent: z.boolean().optional(),
        })
        .optional(),
    });
    const { rootId } = paramsSchema.parse(req.params);
    const body = bodySchema.parse(req.body ?? {});

    try {
      const triggerAt = Date.now() - 1000;
      const newId = createLinkedTicket({
        rootTicketId: rootId,
        type: body.type as any,
        overrides: body.overrides,
      });
      await notifyL720BackendOf811Change({ since: triggerAt });
      const row = db.prepare(`SELECT * FROM tickets_811 WHERE id = ?`).get(newId) as any;
      return reply.send({ created: newId, ticket: shapeTicketForApi(row) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  // Return the full ordered chain for any ticket in a chain.
  app.get("/api/811/tickets/:ticketId/chain", async (req, reply) => {
    const { ticketId } = req.params as any;
    const rows = getTicketChain(ticketId);
    if (rows.length === 0) return reply.code(404).send({ error: "Ticket not found" });
    return reply.send({ chain: rows.map(shapeTicketForApi) });
  });

  app.get("/api/811/tickets", async (req, reply) => {
    const querySchema = z.object({
      memberCode: z.string().min(1).default("USIC"),
      since: z.string().optional(), // ms timestamp as string
      limit: z.string().optional(),
    });
    const q = querySchema.parse(req.query ?? {});
    const since = q.since ? Number(q.since) : 0;
    const limit = q.limit ? Math.min(5000, Math.max(1, Number(q.limit))) : 50;

    // Find tickets that have at least one member matching memberCode
    const tickets = db.prepare(`
      SELECT t.*
      FROM tickets_811 t
      WHERE t.updated_at > ?
        AND EXISTS (
          SELECT 1 FROM ticket_members_811 m
          WHERE m.ticket_id = t.id AND m.member_code = ?
        )
      ORDER BY t.updated_at ASC
      LIMIT ?
    `).all(since, q.memberCode, limit) as any[];

    const membersStmt = db.prepare(`
      SELECT id, member_code, utility_type, company_name, status, response_code, responded_at, notes
      FROM ticket_members_811
      WHERE ticket_id = ?
    `);

    const result = tickets.map(t => ({
      id: t.id,
      ticketNumber: t.ticket_number,
      ticketType: t.ticket_type,
      status: t.status,
      version: t.version,
      areaId: t.area_id,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      dueAt: t.due_at,
      address: `${t.address_line1}, ${t.city}, ${t.state} ${t.zip}`,
      lat: t.lat,
      lng: t.lng,
      // Lineage fields downstream services depend on.
      rootTicketId: t.root_ticket_id,
      parentTicketId: t.parent_ticket_id,
      sequenceNumber: t.sequence_number,
      externalRootNumber: t.external_root_number,
      payloadJson: t.payload_json,
      payload: JSON.parse(t.payload_json || "{}"),
      members: membersStmt.all(t.id),
    }));

    // Optional: when pulled, mark status to SENT_TO_MEMBER if it was NEW
    const markPulled = db.prepare(`
      UPDATE tickets_811
      SET status = CASE WHEN status = 'NEW' THEN 'SENT_TO_MEMBER' ELSE status END,
          updated_at = CASE WHEN status = 'NEW' THEN ? ELSE updated_at END,
          version = CASE WHEN status = 'NEW' THEN version + 1 ELSE version END
      WHERE id = ?
    `);

    const now = Date.now();
    const tx = db.transaction(() => {
      for (const t of tickets) markPulled.run(now, t.id);
    });
    tx();

    return reply.send({ tickets: result });
  });

  app.get("/api/811/tickets/:ticketId", async (req, reply) => {
    const { ticketId } = req.params as any;

    const t = db.prepare(`SELECT * FROM tickets_811 WHERE id = ?`).get(ticketId) as any;
    if (!t) return reply.code(404).send({ error: "Ticket not found" });

    const members = db.prepare(`
      SELECT id, member_code, utility_type, company_name, status, response_code, responded_at, notes
      FROM ticket_members_811 WHERE ticket_id = ?
    `).all(ticketId);

    // Parse payload for additional customer data
    let payloadData = {};
    try {
      payloadData = JSON.parse(t.payload_json || "{}");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error('[811Sim] Failed to parse payload_json for ticket', ticketId, errorMessage);
    }

    return reply.send({
      id: t.id,
      ticketNumber: t.ticket_number,
      ticketType: t.ticket_type,
      status: t.status,
      version: t.version,
      areaId: t.area_id,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      dueAt: t.due_at,
      address: `${t.address_line1}, ${t.city}, ${t.state} ${t.zip}`,
      lat: t.lat,
      lng: t.lng,
      workType: t.work_type,
      markingInstructions: t.marking_instructions,
      rootTicketId: t.root_ticket_id,
      parentTicketId: t.parent_ticket_id,
      sequenceNumber: t.sequence_number,
      externalRootNumber: t.external_root_number,
      contractor: {
        name: t.contractor_name,
        phone: t.contractor_phone,
        contact: {
          name: t.contact_name,
          email: t.contact_email
        }
      },
      payload: payloadData,
      members: members.map((member: any) => ({
        ...member,
        customerName: member.company_name,
        utility: member.utility_type,
        memberCode: member.member_code,
        status: member.status,
        responseCode: member.response_code,
        respondedAt: member.responded_at ? new Date(member.responded_at).toISOString() : null,
        notes: member.notes,
        // Format time for display
        respondedAtFormatted: member.responded_at ? 
          new Date(member.responded_at).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }) : null
      })),
      // Add formatted timestamps
      createdAtFormatted: new Date(t.created_at).toISOString(),
      updatedAtFormatted: new Date(t.updated_at).toISOString(),
      dueAtFormatted: new Date(t.due_at).toISOString(),
    });
  });

  app.post("/api/811/tickets/:ticketId/close", async (req, reply) => {
    const { ticketId } = req.params as any;
    const { closedByName, customerMarkings, closedAt } = req.body as any;

    try {
      const changedAt = closedAt || Date.now();

      // Update ticket status to CLOSED
      const updateStmt = db.prepare(`
        UPDATE tickets_811 
        SET status = 'CLOSED', updated_at = ?, version = version + 1
        WHERE id = ?
      `);

      const result = updateStmt.run(changedAt, ticketId);

      if (result.changes === 0) {
        return reply.code(404).send({ error: "Ticket not found" });
      }

      // Store closure details in payload_json
      const ticket = db.prepare(`SELECT * FROM tickets_811 WHERE id = ?`).get(ticketId) as any;
      if (ticket && ticket.payload_json) {
        const payload = JSON.parse(ticket.payload_json);
        const updatedPayload = {
          ...payload,
          closedByName: closedByName || "Unknown",
          customerMarkings: customerMarkings || {},
          closedAt: changedAt,
          closedAtBackend: Date.now()
        };

        db.prepare(`
          UPDATE tickets_811 
          SET payload_json = ?
          WHERE id = ?
        `).run(JSON.stringify(updatedPayload), ticketId);
      }

      console.log(`[811Sim] Ticket ${ticketId} marked as CLOSED by ${closedByName}`);
      await notifyL720BackendOf811Change({ since: changedAt - 1000 });

      return reply.send({
        success: true,
        ticketId,
        status: 'CLOSED',
        closedAt: changedAt,
        message: `Ticket ${ticketId} closed successfully`
      });

    } catch (error) {
      console.error('[811Sim] Error closing ticket:', error);
      return reply.code(500).send({ error: "Failed to close ticket" });
    }
  });

  // Receive assignment notification from L720 backend.
  // The backend calls this when a ticket is assigned to a tech, so the
  // simulator can reflect the real-world assignment state.
  app.post("/api/811/tickets/:ticketId/assign", async (req, reply) => {
    const { ticketId } = req.params as any;
    const bodySchema = z.object({
      techId: z.string().min(1),
      techName: z.string().min(1),
      locatorStatus: z.string().optional(),
    });
    const body = bodySchema.parse(req.body ?? {});

    try {
      const ticket = db.prepare(`SELECT * FROM tickets_811 WHERE id = ?`).get(ticketId) as any;
      if (!ticket) return reply.code(404).send({ error: "Ticket not found" });

      const now = Date.now();
      const locatorStatus = body.locatorStatus || "ASSIGNED";

      db.prepare(`
        UPDATE tickets_811
        SET status = 'ASSIGNED',
            assigned_tech_id = ?,
            assigned_tech_name = ?,
            locator_status = ?,
            updated_at = ?,
            version = version + 1
        WHERE id = ?
      `).run(body.techId, body.techName, locatorStatus, now, ticketId);

      db.prepare(`
        INSERT INTO ticket_event_log_811 (id, ticket_id, type, occurred_at, payload_json)
        VALUES (?, ?, 'ASSIGNED_TO_TECH', ?, ?)
      `).run(
        crypto.randomUUID(),
        ticketId,
        now,
        JSON.stringify({ techId: body.techId, techName: body.techName, locatorStatus }),
      );

      console.log(`[811Sim] Ticket ${ticketId} assigned to ${body.techName} (${body.techId})`);
      return reply.send({
        success: true,
        ticketId,
        status: "ASSIGNED",
        assignedTechName: body.techName,
        locatorStatus,
      });
    } catch (error) {
      console.error('[811Sim] Error assigning ticket:', error);
      return reply.code(500).send({ error: "Failed to assign ticket" });
    }
  });

  // Receive status update from L720 backend (enroute, onsite, paused, etc.)
  app.post("/api/811/tickets/:ticketId/status", async (req, reply) => {
    const { ticketId } = req.params as any;
    const bodySchema = z.object({
      locatorStatus: z.string().min(1),
      techName: z.string().optional(),
    });
    const body = bodySchema.parse(req.body ?? {});

    try {
      const ticket = db.prepare(`SELECT * FROM tickets_811 WHERE id = ?`).get(ticketId) as any;
      if (!ticket) return reply.code(404).send({ error: "Ticket not found" });

      const now = Date.now();
      db.prepare(`
        UPDATE tickets_811
        SET locator_status = ?,
            updated_at = ?,
            version = version + 1
        WHERE id = ?
      `).run(body.locatorStatus, now, ticketId);

      db.prepare(`
        INSERT INTO ticket_event_log_811 (id, ticket_id, type, occurred_at, payload_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        ticketId,
        `STATUS_${body.locatorStatus}`,
        now,
        JSON.stringify({ locatorStatus: body.locatorStatus, techName: body.techName }),
      );

      return reply.send({ success: true, ticketId, locatorStatus: body.locatorStatus });
    } catch (error) {
      console.error('[811Sim] Error updating ticket status:', error);
      return reply.code(500).send({ error: "Failed to update status" });
    }
  });

  // Revise the due date of an existing ticket.
  // This is the 811-side rescheduling operation. It:
  //   - Preserves the original due_at in original_due_at (set on first revision)
  //   - Updates due_at to the new value
  //   - Increments version
  //   - Logs a DUE_REVISED event in the event log
  //   - Notifies the L720 backend to re-ingest
  app.post("/api/811/tickets/:ticketId/revise-due", async (req, reply) => {
    const { ticketId } = req.params as any;
    const bodySchema = z.object({
      newDueAt: z.number().int().positive(),
      reason: z.string().optional(),
      requestedBy: z.string().optional(),
      remark: z.boolean().optional(),
      source: z.string().optional(),
    });
    const body = bodySchema.parse(req.body ?? {});

    try {
      const ticket = db.prepare(`SELECT * FROM tickets_811 WHERE id = ?`).get(ticketId) as any;
      if (!ticket) return reply.code(404).send({ error: "Ticket not found" });

      const now = Date.now();
      const previousDueAt = ticket.due_at;

      // Set original_due_at on first revision; preserve it on subsequent revisions
      const originalDueAt = ticket.original_due_at ?? previousDueAt;

      // Determine revision type: UPDATE or UPDATE_REMARK
      const revisionType = body.remark ? "UPDATE_REMARK" : "UPDATE";

      db.prepare(`
        UPDATE tickets_811
        SET due_at = ?,
            original_due_at = ?,
            updated_at = ?,
            version = version + 1
        WHERE id = ?
      `).run(body.newDueAt, originalDueAt, now, ticketId);

      db.prepare(`
        INSERT INTO ticket_event_log_811 (id, ticket_id, type, occurred_at, payload_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        ticketId,
        revisionType === "UPDATE_REMARK" ? "UPDATE_REMARK" : "DUE_REVISED",
        now,
        JSON.stringify({
          previousDueAt,
          newDueAt: body.newDueAt,
          originalDueAt,
          reason: body.reason,
          requestedBy: body.requestedBy,
          revisionType,
          source: body.source || "811_UPDATE",
        }),
      );

      console.log(`[811Sim] Ticket ${ticketId} ${revisionType}: due ${previousDueAt} -> ${body.newDueAt}`);

      // Notify L720 backend to re-ingest the updated ticket
      await notifyL720BackendOf811Change({ since: now - 1000 });

      const updated = db.prepare(`SELECT * FROM tickets_811 WHERE id = ?`).get(ticketId) as any;
      return reply.send({
        success: true,
        ticketId,
        previousDueAt,
        newDueAt: body.newDueAt,
        originalDueAt,
        version: updated.version,
        revisionType,
      });
    } catch (error) {
      console.error('[811Sim] Error revising due date:', error);
      return reply.code(500).send({ error: "Failed to revise due date" });
    }
  });
}
