import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "../db/db.js";
import { buildTicketScope } from "../domain/scope.js";
import { notifyL720BackendOf811Change } from "../services/dispatchNotifier.js";
import { AREAS, type AreaId } from "../domain/areas.js";

const AREA_IDS = AREAS.map((a) => a.id) as [AreaId, ...AreaId[]];

function getAreaBounds(areaId: string) {
  const area = db
    .prepare(
      `
      SELECT lat_min, lat_max, lng_min, lng_max
      FROM service_areas
      WHERE id = ?
    `,
    )
    .get(areaId) as
    | { lat_min: number; lat_max: number; lng_min: number; lng_max: number }
    | undefined;

  if (!area) {
    throw new Error(`Area not found for scope generation: ${areaId}`);
  }

  return area;
}

function parsePayloadJson(payloadJson?: string) {
  try {
    return JSON.parse(payloadJson || "{}");
  } catch {
    return {};
  }
}

function buildScopePayload(params: {
  ticketId: string;
  ticketNumber: string;
  ticketType: "NORMAL" | "EMERGENCY" | "DIGUP" | "NON_COMPLIANT" | "UPDATE" | "UPDATE_REMARK" | "RECALL" | "NO_RESPONSE";
  areaId: string;
  lat: number;
  lng: number;
  workType?: string;
}) {
  const { ticketId, ticketNumber, ticketType, areaId, lat, lng, workType } = params;
  const normalizedWorkType = workType || "STANDARD";

  return buildTicketScope({
    seed: `${ticketId}:${ticketNumber}:${normalizedWorkType}:${ticketType}`,
    centerLat: lat,
    centerLng: lng,
    workType: normalizedWorkType,
    ticketType,
    areaBounds: getAreaBounds(areaId),
  });
}

export async function opsRoutes(app: FastifyInstance) {
  /**
   * GET /api/ops/811/tickets
   * Get all 811 tickets with optional filtering
   */
  app.get("/api/ops/811/tickets", async (req, reply) => {
    try {
      const { status, areaId, page = 1, limit = 50 } = req.query as any;

      let query = `
        SELECT t.*, 
               COUNT(m.id) as member_count
        FROM tickets_811 t
        LEFT JOIN ticket_members_811 m ON t.id = m.ticket_id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (status) {
        query += " AND t.status = ?";
        params.push(status);
      }

      if (areaId) {
        query += " AND t.area_id = ?";
        params.push(areaId);
      }

      query += " GROUP BY t.id ORDER BY t.created_at DESC";

      // Add pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      query += " LIMIT ? OFFSET ?";
      params.push(parseInt(limit), offset);

      const tickets = db.prepare(query).all(...params) as any[];

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(DISTINCT id) as count 
        FROM tickets_811 
        WHERE 1=1
        ${status ? "AND status = ?" : ""}
        ${areaId ? "AND area_id = ?" : ""}
      `;
      const countParams: any[] = [];
      if (status) countParams.push(status);
      if (areaId) countParams.push(areaId);

      const totalResult = db.prepare(countQuery).get(...countParams) as any;
      const total = totalResult.count;

      const formattedTickets = tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        ticketType: ticket.ticket_type,
        status: ticket.status,
        locatorStatus: ticket.locator_status || null,
        assignedTechName: ticket.assigned_tech_name || null,
        assignedTechId: ticket.assigned_tech_id || null,
        areaId: ticket.area_id,
        address: `${ticket.address_line1}, ${ticket.city}, ${ticket.state} ${ticket.zip}`,
        lat: ticket.lat,
        lng: ticket.lng,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        dueAt: ticket.due_at,
        version: ticket.version,
        memberCount: ticket.member_count,
        payloadJson: ticket.payload_json,
        payload: parsePayloadJson(ticket.payload_json),
      }));

      return reply.send({
        tickets: formattedTickets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("[811 OPS] Error fetching tickets:", error);
      return reply.code(500).send({ error: "Failed to fetch tickets" });
    }
  });

  /**
   * GET /api/ops/811/tickets/:id
   * Get specific 811 ticket with members
   */
  app.get("/api/ops/811/tickets/:id", async (req, reply) => {
    try {
      const { id } = req.params as any;

      const ticket = db
        .prepare("SELECT * FROM tickets_811 WHERE id = ?")
        .get(id) as any;

      if (!ticket) {
        return reply.code(404).send({ error: "Ticket not found" });
      }

      const members = db
        .prepare("SELECT * FROM ticket_members_811 WHERE ticket_id = ?")
        .all(id) as any[];

      const events = db
        .prepare(
          `
        SELECT * FROM ticket_event_log_811 
        WHERE ticket_id = ? 
        ORDER BY occurred_at DESC
      `,
        )
        .all(id) as any[];

      // Parse payload for additional customer data
      let payloadData = {};
      try {
        payloadData = JSON.parse(ticket.payload_json || "{}");
      } catch (e: any) {
        console.error('[811 OPS] Failed to parse payload_json for ticket', id, e.message);
      }

      return reply.send({
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        ticketType: ticket.ticket_type,
        status: ticket.status,
        version: ticket.version,
        areaId: ticket.area_id,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        dueAt: ticket.due_at,
        address: `${ticket.address_line1}, ${ticket.city}, ${ticket.state} ${ticket.zip}`,
        lat: ticket.lat,
        lng: ticket.lng,
        workType: ticket.work_type,
        markingInstructions: ticket.marking_instructions,
        contractor: {
          name: ticket.contractor_name,
          phone: ticket.contractor_phone,
          contact: {
            name: ticket.contact_name,
            email: ticket.contact_email
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
        events: events.map((event) => ({
          id: event.id,
          type: event.type,
          payload: JSON.parse(event.payload_json || "{}"),
          occurredAt: event.occurred_at,
        })),
      });
    } catch (error) {
      console.error("[811 OPS] Error fetching ticket detail:", error);
      return reply.code(500).send({ error: "Failed to fetch ticket detail" });
    }
  });

  /**
   * POST /api/ops/811/tickets
   * Create new 811 ticket
   */
  app.post("/api/ops/811/tickets", async (req, reply) => {
    try {
      const bodySchema = z.object({
        ticketNumber: z.string().min(1),
        ticketType: z.enum(["NORMAL", "EMERGENCY", "DIGUP", "NON_COMPLIANT", "UPDATE", "UPDATE_REMARK", "RECALL", "NO_RESPONSE"]).default("NORMAL"),
        areaId: z.enum(AREA_IDS),
        address: z.string().min(1),
        lat: z.number(),
        lng: z.number(),
        workType: z.string().optional(),
        contractor: z.string().optional(),
        contractorPhone: z.string().optional(),
        contactName: z.string().optional(),
        contactEmail: z.string().optional(),
        markingInstructions: z.string().optional(),
        dueAt: z.number().optional(),
      });

      const body = bodySchema.parse(req.body);

      const ticketId = crypto.randomUUID();
      const now = Date.now();
      const dueAt = body.dueAt || now + 24 * 60 * 60 * 1000; // 24 hours from now

      // Insert ticket
      const scope = buildScopePayload({
        ticketId,
        ticketNumber: body.ticketNumber,
        ticketType: body.ticketType,
        areaId: body.areaId,
        lat: body.lat,
        lng: body.lng,
        workType: body.workType,
      });

      const insertTicket = db.prepare(`
        INSERT INTO tickets_811 (
          id, ticket_number, ticket_type, status, version, area_id,
          created_at, updated_at, due_at,
          address_line1, city, state, zip, lat, lng,
          work_type, marking_instructions,
          contractor_name, contractor_phone, contact_name, contact_email,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const payloadJson = JSON.stringify({
        externalSource: "OPS_MANUAL",
        ticketId,
        ticketNumber: body.ticketNumber,
        ticketType: body.ticketType,
        areaId: body.areaId,
        address: body.address,
        lat: body.lat,
        lng: body.lng,
        scope,
        workType: body.workType || "STANDARD",
        contractor: body.contractor || "Unknown",
        contractorPhone: body.contractorPhone || "",
        contactName: body.contactName || "",
        contactEmail: body.contactEmail || "",
        markingInstructions: body.markingInstructions || "",
        customers: [],
      });

      insertTicket.run(
        ticketId,
        body.ticketNumber,
        body.ticketType,
        "NEW",
        1,
        body.areaId,
        now,
        now,
        dueAt,
        body.address,
        (() => {
          const a = AREAS.find((x) => x.id === body.areaId);
          return a ? a.name.replace(/, TX$/, "") : "Unknown";
        })(),
        "TX",
        (() => {
          // Default zip — not critical for simulation
          return "75000";
        })(),
        body.lat,
        body.lng,
        body.workType || "STANDARD",
        body.markingInstructions || "",
        body.contractor || "Unknown",
        body.contractorPhone || "",
        body.contactName || "",
        body.contactEmail || "",
        payloadJson,
      );

      // Add members (default USIC for all utilities)
      const insertMember = db.prepare(`
        INSERT INTO ticket_members_811 (
          id, ticket_id, member_code, utility_type, company_name, status
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const utilities = ["GAS", "ELECTRIC", "WATER", "SEWER", "FIBER"];
      utilities.forEach((utility) => {
        const memberId = crypto.randomUUID();
        insertMember.run(
          memberId,
          ticketId,
          "USIC",
          utility,
          "USIC SIM MEMBER",
          "OPEN",
        );
      });

      // Log creation event
      const insertEvent = db.prepare(`
        INSERT INTO ticket_event_log_811 (id, ticket_id, type, occurred_at, payload_json)
        VALUES (?, ?, ?, ?, ?)
      `);

      const eventId = crypto.randomUUID();
      insertEvent.run(
        eventId,
        ticketId,
        "TICKET_CREATED",
        now,
        JSON.stringify({ source: "OPS_PORTAL", createdBy: "ops_user" }),
      );

      console.log(
        `[811 OPS] Created ticket ${body.ticketNumber} (${ticketId})`,
      );
      await notifyL720BackendOf811Change({ since: now - 1000 });

      return reply.send({
        id: ticketId,
        ticketNumber: body.ticketNumber,
        message: "Ticket created successfully",
      });
    } catch (error) {
      console.error("[811 OPS] Error creating ticket:", error);
      return reply.code(500).send({ error: "Failed to create ticket" });
    }
  });

  /**
   * PUT /api/ops/811/tickets/:id
   * Update existing 811 ticket
   */
  app.put("/api/ops/811/tickets/:id", async (req, reply) => {
    try {
      const { id } = req.params as any;

      const bodySchema = z.object({
        ticketNumber: z.string().min(1).optional(),
        ticketType: z.enum(["NORMAL", "EMERGENCY", "DIGUP", "NON_COMPLIANT", "UPDATE", "UPDATE_REMARK", "RECALL", "NO_RESPONSE"]).optional(),
        status: z
          .enum(["NEW", "SENT_TO_MEMBER", "ASSIGNED", "RESPONDED", "CLOSED"])
          .optional(),
        areaId: z.enum(AREA_IDS).optional(),
        address: z.string().min(1).optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        workType: z.string().optional(),
        contractor: z.string().optional(),
        contractorPhone: z.string().optional(),
        contactName: z.string().optional(),
        contactEmail: z.string().optional(),
        markingInstructions: z.string().optional(),
        dueAt: z.number().optional(),
      });

      const body = bodySchema.parse(req.body);

      // Check if ticket exists
      const existingTicket = db
        .prepare("SELECT * FROM tickets_811 WHERE id = ?")
        .get(id) as any;

      if (!existingTicket) {
        return reply.code(404).send({ error: "Ticket not found" });
      }

      // Build dynamic update query
      const updates: string[] = [];
      const params: any[] = [];

      const fieldMap: Record<string, string> = {
        ticketNumber: "ticket_number",
        ticketType: "ticket_type",
        status: "status",
        areaId: "area_id",
        address: "address_line1",
        lat: "lat",
        lng: "lng",
        workType: "work_type",
        contractor: "contractor_name",
        contractorPhone: "contractor_phone",
        contactName: "contact_name",
        contactEmail: "contact_email",
        markingInstructions: "marking_instructions",
        dueAt: "due_at",
      };

      Object.entries(fieldMap).forEach(([bodyField, column]) => {
        const value = body[bodyField as keyof typeof body];
        if (value !== undefined) {
          updates.push(`${column} = ?`);
          params.push(value);
        }
      });

      if (updates.length === 0) {
        return reply.code(400).send({ error: "No valid fields to update" });
      }

      const nextAreaId = body.areaId || existingTicket.area_id;
      const nextLat = body.lat ?? existingTicket.lat;
      const nextLng = body.lng ?? existingTicket.lng;
      const nextTicketNumber = body.ticketNumber || existingTicket.ticket_number;
      const nextTicketType = body.ticketType || existingTicket.ticket_type;
      const nextWorkType = body.workType || existingTicket.work_type || "STANDARD";
      const existingPayload = parsePayloadJson(existingTicket.payload_json);
      const nextScope = buildScopePayload({
        ticketId: id,
        ticketNumber: nextTicketNumber,
        ticketType: nextTicketType,
        areaId: nextAreaId,
        lat: nextLat,
        lng: nextLng,
        workType: nextWorkType,
      });
      const nextPayload = {
        ...existingPayload,
        ticketId: id,
        ticketNumber: nextTicketNumber,
        ticketType: nextTicketType,
        areaId: nextAreaId,
        address: body.address || existingPayload.address || existingTicket.address_line1,
        lat: nextLat,
        lng: nextLng,
        scope: nextScope,
        workType: nextWorkType,
        contractor: body.contractor || existingPayload.contractor || existingTicket.contractor_name,
        contractorPhone:
          body.contractorPhone ||
          existingPayload.contractorPhone ||
          existingTicket.contractor_phone,
        contactName: body.contactName || existingPayload.contactName || existingTicket.contact_name,
        contactEmail:
          body.contactEmail || existingPayload.contactEmail || existingTicket.contact_email,
        markingInstructions:
          body.markingInstructions ||
          existingPayload.markingInstructions ||
          existingTicket.marking_instructions,
      };

      updates.push("updated_at = ?");
      updates.push("payload_json = ?");
      updates.push("version = version + 1");
      params.push(Date.now(), JSON.stringify(nextPayload), id);

      const updateQuery = `UPDATE tickets_811 SET ${updates.join(", ")} WHERE id = ?`;
      db.prepare(updateQuery).run(...params);

      // Log update event
      const insertEvent = db.prepare(`
        INSERT INTO ticket_event_log_811 (id, ticket_id, type, occurred_at, payload_json)
        VALUES (?, ?, ?, ?, ?)
      `);

      const eventId = crypto.randomUUID();
      insertEvent.run(
        eventId,
        id,
        "TICKET_UPDATED",
        Date.now(),
        JSON.stringify({
          source: "OPS_PORTAL",
          updatedFields: Object.keys(body),
          scopeRegenerated: true,
        }),
      );

      console.log(`[811 OPS] Updated ticket ${id}`);
      await notifyL720BackendOf811Change({ since: Date.now() - 1000 });

      return reply.send({
        id,
        message: "Ticket updated successfully",
        updatedFields: Object.keys(body),
      });
    } catch (error) {
      console.error("[811 OPS] Error updating ticket:", error);
      return reply.code(500).send({ error: "Failed to update ticket" });
    }
  });

  /**
   * DELETE /api/ops/811/tickets/:id
   * Delete 811 ticket
   */
  app.delete("/api/ops/811/tickets/:id", async (req, reply) => {
    try {
      const { id } = req.params as any;

      // Check if ticket exists
      const existingTicket = db
        .prepare("SELECT * FROM tickets_811 WHERE id = ?")
        .get(id) as any;

      if (!existingTicket) {
        return reply.code(404).send({ error: "Ticket not found" });
      }

      // Delete members first (foreign key constraint)
      db.prepare("DELETE FROM ticket_members_811 WHERE ticket_id = ?").run(id);

      // Delete events
      db.prepare("DELETE FROM ticket_event_log_811 WHERE ticket_id = ?").run(
        id,
      );

      // Delete ticket
      db.prepare("DELETE FROM tickets_811 WHERE id = ?").run(id);

      console.log(
        `[811 OPS] Deleted ticket ${id} (${existingTicket.ticket_number})`,
      );
      await notifyL720BackendOf811Change({ reconcileMissing: true });

      return reply.send({
        message: "Ticket deleted successfully",
        ticketNumber: existingTicket.ticket_number,
      });
    } catch (error) {
      console.error("[811 OPS] Error deleting ticket:", error);
      return reply.code(500).send({ error: "Failed to delete ticket" });
    }
  });

  /**
   * POST /api/ops/811/generate
   * Generate test tickets
   */
  app.post("/api/ops/811/generate", async (req, reply) => {
    try {
      const { count = 5, areaId } = req.body as any;

      // Treat empty string or whitespace-only areaId as "no specific area"
      // so the generator picks randomly from all configured areas.
      const normalizedAreaId =
        typeof areaId === "string" && areaId.trim().length > 0 ? areaId : undefined;

      // Import the existing generator
      const { generateTickets } = await import("../domain/generator.js");

      const tickets = generateTickets({ areaId: normalizedAreaId as any, count });

      console.log(`[811 OPS] Generated ${tickets.length} test tickets`);
      await notifyL720BackendOf811Change({ since: Date.now() - 1000 });

      return reply.send({
        message: `Generated ${tickets.length} test tickets`,
        ticketIds: tickets,
        tickets: tickets.map((ticketId: string) => ({
          id: ticketId,
          ticketNumber: ticketId,
          areaId,
        })),
      });
    } catch (error) {
      console.error("[811 OPS] Error generating tickets:", error);
      return reply.code(500).send({ error: "Failed to generate tickets" });
    }
  });

  /**
   * DELETE /api/ops/811/reset
   * Reset 811 database
   */
  app.delete("/api/ops/811/reset", async (req, reply) => {
    try {
      // Delete all data
      db.prepare("DELETE FROM ticket_members_811").run();
      db.prepare("DELETE FROM ticket_event_log_811").run();
      db.prepare("DELETE FROM tickets_811").run();

      console.log(`[811 OPS] Reset 811 database`);
      await notifyL720BackendOf811Change({ reconcileMissing: true });

      return reply.send({
        message: "811 database reset successfully",
      });
    } catch (error) {
      console.error("[811 OPS] Error resetting database:", error);
      return reply.code(500).send({ error: "Failed to reset database" });
    }
  });

  /**
   * GET /api/ops/811/stats
   * Get 811 system statistics
   */
  app.get("/api/ops/811/stats", async (req, reply) => {
    try {
      const totalTickets = db
        .prepare("SELECT COUNT(*) as count FROM tickets_811")
        .get() as any;

      return reply.send({
        total: totalTickets.count,
        message: "Stats retrieved successfully",
      });
    } catch (error) {
      console.error("[811 OPS] Error fetching stats:", error);
      return reply.code(500).send({ error: "Failed to fetch stats" });
    }
  });

  /**
   * GET /api/ops/811/areas
   * Get area ticket distribution
   */
  app.get("/api/ops/811/areas", async (req, reply) => {
    try {
      const areas = db
        .prepare(
          `
        SELECT
          area_id as areaId,
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'NEW' THEN 1 END) as new,
          COUNT(CASE WHEN status = 'SENT_TO_MEMBER' THEN 1 END) as sent,
          COUNT(CASE WHEN status = 'ASSIGNED' THEN 1 END) as assigned,
          COUNT(CASE WHEN status = 'RESPONDED' THEN 1 END) as responded,
          COUNT(CASE WHEN status = 'CLOSED' THEN 1 END) as closed
        FROM tickets_811
        GROUP BY area_id
        ORDER BY area_id
      `,
        )
        .all() as any[];

      return reply.send(areas);
    } catch (error) {
      console.error("[811 OPS] Error fetching area distribution:", error);
      return reply
        .code(500)
        .send({ error: "Failed to fetch area distribution" });
    }
  });
}
