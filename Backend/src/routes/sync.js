import express from "express";
import { db } from "../server.js";
import { v4 as uuidv4 } from "uuid";
import {
  handleTicketClosure,
  processOutbound811Events,
  queueOutbound811Event,
} from "../services/outbound811Service.js";
import {
  validateEventStructure,
  validateTicketCustomerMarkingSetEvent,
  validateTicketStatusSetEvent,
  validateTicketClosedEvent,
} from "../validation/eventValidator.js";
import {
  isEventProcessed,
  markEventProcessed,
  getProcessedEventResult,
} from "../services/idempotencyService.js";
import { emitOpsEvent } from "../utils/opsEventBus.js";
import { buildTicketVisibilityFilter } from "../services/territoryService.js";

const router = express.Router();
let syncStatements;

function getSyncStatements() {
  if (syncStatements) {
    return syncStatements;
  }

  syncStatements = {
    insertProductionLedgerEntry: db.prepare(`
      INSERT OR IGNORE INTO utility_production_ledger (
        id,
        request_id,
        ticket_id,
        user_id,
        customer_id,
        customer_name,
        utility_type,
        minutes_delta,
        footage_delta,
        completed_delta,
        source_event_type,
        occurred_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertTicketEvent: db.prepare(`
      INSERT INTO ticket_events (
        id,
        ticket_id,
        event_type,
        old_status,
        new_status,
        old_locator_status,
        new_locator_status,
        user_id,
        notes,
        payload_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
  };

  return syncStatements;
}

function parseWholeNumber(value) {
  const parsed = parseInt(value || "0", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getCustomerLookup(payload = {}) {
  const nestedPayload =
    payload?.originalTicketData?.payload ||
    (() => {
      try {
        return payload?.originalTicketData?.payloadJson
          ? JSON.parse(payload.originalTicketData.payloadJson)
          : {};
      } catch {
        return {};
      }
    })();

  const customers = [
    ...(Array.isArray(payload.customers) ? payload.customers : []),
    ...(Array.isArray(nestedPayload?.customers) ? nestedPayload.customers : []),
  ];

  const lookup = new Map();
  for (const customer of customers) {
    if (customer?.id && !lookup.has(customer.id)) {
      lookup.set(customer.id, customer);
    }
  }

  return lookup;
}

function recordUtilityProductionDeltas({
  requestId,
  eventType,
  ticketId,
  userId,
  occurredAt,
  previousPayload,
  nextPayload,
}) {
  const { insertProductionLedgerEntry } = getSyncStatements();
  const previousMarking =
    previousPayload?.customerMarking || previousPayload?.customerMarkings || {};
  const nextMarking =
    nextPayload?.customerMarking || nextPayload?.customerMarkings || {};
  const customerLookup = getCustomerLookup(nextPayload);

  for (const [customerId, nextData] of Object.entries(nextMarking)) {
    const prevData = previousMarking?.[customerId] || {};
    const minutesDelta = Math.max(
      0,
      parseWholeNumber(nextData?.minutes) - parseWholeNumber(prevData?.minutes),
    );
    const footageDelta = Math.max(
      0,
      parseWholeNumber(nextData?.footage) - parseWholeNumber(prevData?.footage),
    );
    const completedDelta =
      nextData?.completed === true && prevData?.completed !== true ? 1 : 0;

    if (minutesDelta === 0 && footageDelta === 0 && completedDelta === 0) {
      continue;
    }

    const customer = customerLookup.get(customerId);
    insertProductionLedgerEntry.run(
      `${requestId}:${customerId}`,
      requestId,
      ticketId,
      userId || null,
      customerId,
      customer?.name || null,
      customer?.utility || null,
      minutesDelta,
      footageDelta,
      completedDelta,
      eventType,
      occurredAt || Date.now(),
    );
  }
}

function mergePayloadUpdates(existingPayloadJson, payloadUpdates = {}) {
  const existingPayload = JSON.parse(existingPayloadJson || "{}");
  const normalizedPayloadUpdates = { ...payloadUpdates };

  if (
    normalizedPayloadUpdates.customerMarkings &&
    !normalizedPayloadUpdates.customerMarking
  ) {
    normalizedPayloadUpdates.customerMarking =
      normalizedPayloadUpdates.customerMarkings;
  }

  if (
    normalizedPayloadUpdates.customerMarking &&
    !normalizedPayloadUpdates.customerMarkings
  ) {
    normalizedPayloadUpdates.customerMarkings =
      normalizedPayloadUpdates.customerMarking;
  }

  return {
    mergedPayload: { ...existingPayload, ...normalizedPayloadUpdates },
    normalizedPayloadUpdates,
  };
}

function summarizeCustomerMarkingChange(previousPayload = {}, nextPayload = {}) {
  const previousMarking =
    previousPayload?.customerMarking || previousPayload?.customerMarkings || {};
  const nextMarking =
    nextPayload?.customerMarking || nextPayload?.customerMarkings || {};

  let completedChanges = 0;
  let productionChanges = 0;

  for (const [customerId, nextData] of Object.entries(nextMarking)) {
    const prevData = previousMarking?.[customerId] || {};
    const minutesChanged = parseWholeNumber(nextData?.minutes) !== parseWholeNumber(prevData?.minutes);
    const footageChanged = parseWholeNumber(nextData?.footage) !== parseWholeNumber(prevData?.footage);
    const completedChanged = (nextData?.completed === true) !== (prevData?.completed === true);
    const statusChanged = (nextData?.status || "") !== (prevData?.status || "");
    const resultChanged = (nextData?.result || "") !== (prevData?.result || "");

    if (minutesChanged || footageChanged) {
      productionChanges += 1;
    }

    if (completedChanged || statusChanged || resultChanged) {
      completedChanges += 1;
    }
  }

  if (productionChanges === 0 && completedChanges === 0) {
    return "Customer marking saved with no material changes";
  }

  return `Customer marking updated for ${Object.keys(nextMarking).length} utilities (${productionChanges} production edits, ${completedChanges} status/result edits)`;
}

function recordTicketEventHistory({
  requestId,
  eventType,
  ticket,
  userId,
  occurredAt,
  oldStatus,
  newStatus,
  oldLocatorStatus,
  newLocatorStatus,
  notes,
  payloadSnapshot,
}) {
  const { insertTicketEvent } = getSyncStatements();
  insertTicketEvent.run(
    `tevt-${requestId}`,
    ticket.id,
    eventType,
    oldStatus ?? ticket.status ?? null,
    newStatus ?? ticket.status ?? null,
    oldLocatorStatus ?? ticket.locator_status ?? null,
    newLocatorStatus ?? ticket.locator_status ?? null,
    userId || null,
    notes || null,
    JSON.stringify(payloadSnapshot || {}),
    occurredAt || Date.now(),
  );
}

/**
 * POST /api/sync/events
 * Receive outbox events from mobile app and apply them
 */
router.post("/events", (req, res) => {
  const { events } = req.body;

  if (!events || !Array.isArray(events)) {
    return res.status(400).json({ error: "Invalid events array" });
  }

  console.log("[Sync] Received", events.length, "events from mobile app");

  const results = [];

  for (const event of events) {
    try {
      const { type, requestId, payload } = event;

      console.log("[Sync] Processing event:", type, "requestId:", requestId);

      // Check idempotency - return cached result if already processed
      if (isEventProcessed(requestId)) {
        const cachedResult = getProcessedEventResult(requestId);
        console.log("[Sync] Event already processed (idempotent):", requestId);
        results.push(cachedResult);
        continue;
      }

      // Validate event structure
      const structureValidation = validateEventStructure(event);
      if (!structureValidation.valid) {
        const errorResult = {
          requestId,
          status: "ERROR",
          error: structureValidation.error,
        };
        markEventProcessed(requestId, errorResult);
        results.push(errorResult);
        continue;
      }

      if (type === "TICKET_STATUS_SET") {
        const { ticketId, nextStatus, payloadUpdates } = payload;

        // Get ticket
        const ticket = db
          .prepare("SELECT * FROM tickets WHERE id = ?")
          .get(ticketId);

        // Validate event against current ticket state
        const validation = validateTicketStatusSetEvent(event, ticket);
        if (!validation.valid) {
          const errorResult = {
            requestId,
            status: "ERROR",
            error: validation.error,
          };
          markEventProcessed(requestId, errorResult);
          results.push(errorResult);
          continue;
        }

        // Preserve and potentially update payload
        let updatedPayloadJson = ticket.payload_json;
        const previousPayload = JSON.parse(ticket.payload_json || "{}");
        if (payloadUpdates) {
          const { mergedPayload } = mergePayloadUpdates(ticket.payload_json, payloadUpdates);
          updatedPayloadJson = JSON.stringify(mergedPayload);
          recordUtilityProductionDeltas({
            requestId,
            eventType: type,
            ticketId,
            userId: payload.userId,
            occurredAt: event.occurredAt,
            previousPayload,
            nextPayload: mergedPayload,
          });

          // Log timeline fields being stored
          const timelineFields = [
            "onsiteStartedAt",
            "onsiteEndedAt",
            "enrouteStartedAt",
            "enrouteEndedAt",
            "pauseEvents",
            "closedAt",
            "customerMarking",
            "customerMarkings",
          ];
          const presentFields = timelineFields.filter(
            (f) => mergedPayload[f] !== undefined,
          );
          if (presentFields.length > 0) {
            console.log(
              `[Sync] Storing timeline data for ${ticketId}:`,
              presentFields.join(", "),
            );
          }
        }

        // Update ticket status and preserve payload
        // If closing ticket, update both status and locator_status in one statement
        let resultingStatus = ticket.status;
        let resultingLocatorStatus = nextStatus;
        if (nextStatus === "CLOSED" || nextStatus === "UNABLE") {
          const mergedPayload = JSON.parse(updatedPayloadJson || "{}");
          resultingStatus = "CLOSED";
          db.prepare(
            `
            UPDATE tickets 
            SET status = ?, locator_status = ?, payload_json = ?, closed_by_name = ?, closed_at = ?, updated_at = ?, version = version + 1
            WHERE id = ?
          `,
          ).run(
            "CLOSED",
            nextStatus,
            updatedPayloadJson,
            mergedPayload.closedByName || ticket.closed_by_name || null,
            mergedPayload.closedAt || Date.now(),
            Date.now(),
            ticketId,
          );
        } else {
          // For non-closing statuses, only update locator_status
          db.prepare(
            `
            UPDATE tickets 
            SET locator_status = ?, payload_json = ?, updated_at = ?, version = version + 1
            WHERE id = ?
          `,
          ).run(nextStatus, updatedPayloadJson, Date.now(), ticketId);
        }

        recordTicketEventHistory({
          requestId,
          eventType: type,
          ticket,
          userId: payload.userId,
          occurredAt: event.occurredAt,
          oldStatus: ticket.status,
          newStatus: resultingStatus,
          oldLocatorStatus: ticket.locator_status,
          newLocatorStatus: resultingLocatorStatus,
          notes: `Locator status changed from ${ticket.locator_status} to ${resultingLocatorStatus}`,
          payloadSnapshot: JSON.parse(updatedPayloadJson || "{}"),
        });

        // Verify the update worked
        const verifyTicket = db
          .prepare(
            "SELECT ticket_number, status, locator_status FROM tickets WHERE id = ?",
          )
          .get(ticketId);
        console.log(
          `[Sync] Updated ticket ${verifyTicket.ticket_number} (${ticketId}): status=${verifyTicket.status}, locatorStatus=${verifyTicket.locator_status}`,
        );

        // Verify what was stored (optional logging)
        try {
          const updatedTicket = db
            .prepare("SELECT payload_json FROM tickets WHERE id = ?")
            .get(ticketId);
          if (updatedTicket && updatedTicket.payload_json) {
            const storedPayload = JSON.parse(updatedTicket.payload_json);
            console.log(
              "[Sync] Stored payload keys:",
              Object.keys(storedPayload).join(", "),
            );
          }
        } catch (e) {
          console.warn("[Sync] Could not verify stored payload:", e.message);
        }

        // Queue outbound event to 811 if this is an 811 ticket closure
        if (nextStatus === "CLOSED" && ticket.source === '811') {
          try {
            const outboundEventId = queueOutbound811Event(db, {
              ticketId,
              externalTicketId: ticket.external_ticket_id,
              eventType: 'TICKET_CLOSED',
              payload: {
                closedByUserId: payload.userId,
                closedByName: JSON.parse(updatedPayloadJson).closedByName || "Unknown",
                customerMarkings:
                  JSON.parse(updatedPayloadJson).customerMarking ||
                  JSON.parse(updatedPayloadJson).customerMarkings ||
                  {},
                closedAt: Date.now()
              }
            });
            console.log(`[Sync] Queued outbound 811 closure event ${outboundEventId} for ticket ${ticketId}`);
          } catch (error) {
            console.error(`[Sync] Failed to queue outbound 811 event for ticket ${ticketId}:`, error.message);
          }
        }

        emitOpsEvent("ticket.updated", {
          ticketId,
          ticketNumber: ticket.ticket_number,
          status: resultingStatus,
          locatorStatus: resultingLocatorStatus,
          assignedTechId: ticket.assigned_tech_id,
          by: payload.userId,
        });

        const successResult = { requestId, status: "OK" };
        markEventProcessed(requestId, successResult);
        results.push(successResult);
      } else if (type === "TICKET_CUSTOMER_MARKING_SET") {
        const { ticketId, payloadUpdates } = payload;

        const ticket = db
          .prepare("SELECT * FROM tickets WHERE id = ?")
          .get(ticketId);

        const validation = validateTicketCustomerMarkingSetEvent(event, ticket);
        if (!validation.valid) {
          const errorResult = {
            requestId,
            status: "ERROR",
            error: validation.error,
          };
          markEventProcessed(requestId, errorResult);
          results.push(errorResult);
          continue;
        }

        const previousPayload = JSON.parse(ticket.payload_json || "{}");
        const { mergedPayload } = mergePayloadUpdates(ticket.payload_json, payloadUpdates);
        const updatedPayloadJson = JSON.stringify(mergedPayload);

        recordUtilityProductionDeltas({
          requestId,
          eventType: type,
          ticketId,
          userId: payload.userId,
          occurredAt: event.occurredAt,
          previousPayload,
          nextPayload: mergedPayload,
        });

        db.prepare(
          `
            UPDATE tickets
            SET payload_json = ?, updated_at = ?, version = version + 1
            WHERE id = ?
          `,
        ).run(updatedPayloadJson, Date.now(), ticketId);

        recordTicketEventHistory({
          requestId,
          eventType: type,
          ticket,
          userId: payload.userId,
          occurredAt: event.occurredAt,
          oldStatus: ticket.status,
          newStatus: ticket.status,
          oldLocatorStatus: ticket.locator_status,
          newLocatorStatus: ticket.locator_status,
          notes: summarizeCustomerMarkingChange(previousPayload, mergedPayload),
          payloadSnapshot: mergedPayload,
        });

        emitOpsEvent("ticket.updated", {
          ticketId,
          ticketNumber: ticket.ticket_number,
          status: ticket.status,
          locatorStatus: ticket.locator_status,
          assignedTechId: ticket.assigned_tech_id,
          by: payload.userId,
        });

        const successResult = { requestId, status: "OK" };
        markEventProcessed(requestId, successResult);
        results.push(successResult);
      } else if (type === "TICKET_CLOSED") {
        const { ticketId, closedByUserId, customerMarkings } = payload;

        // Get ticket
        const ticket = db
          .prepare("SELECT * FROM tickets WHERE id = ?")
          .get(ticketId);

        // Validate event against current ticket state
        const validation = validateTicketClosedEvent(event, ticket);
        if (!validation.valid) {
          const errorResult = {
            requestId,
            status: "ERROR",
            error: validation.error,
          };
          markEventProcessed(requestId, errorResult);
          results.push(errorResult);
          continue;
        }

        // Parse existing payload
        const existingPayload = JSON.parse(ticket.payload_json || "{}");

        // Update with customer markings
        const updatedPayload = {
          ...existingPayload,
          customerMarking: customerMarkings,
          customerMarkings,
          closedAt: Date.now(),
          closedByUserId,
        };

        recordUtilityProductionDeltas({
          requestId,
          eventType: type,
          ticketId,
          userId: closedByUserId,
          occurredAt: event.occurredAt,
          previousPayload: existingPayload,
          nextPayload: updatedPayload,
        });

        // Update ticket to CLOSED
        db.prepare(
          `
          UPDATE tickets 
          SET status = ?, locator_status = ?, payload_json = ?, closed_by_name = ?, closed_at = ?, updated_at = ?, version = version + 1
          WHERE id = ?
        `,
        ).run(
          "CLOSED",
          "CLOSED",
          JSON.stringify(updatedPayload),
          updatedPayload.closedByName || ticket.closed_by_name || null,
          updatedPayload.closedAt,
          Date.now(),
          ticketId,
        );

        recordTicketEventHistory({
          requestId,
          eventType: type,
          ticket,
          userId: closedByUserId,
          occurredAt: event.occurredAt,
          oldStatus: ticket.status,
          newStatus: "CLOSED",
          oldLocatorStatus: ticket.locator_status,
          newLocatorStatus: "CLOSED",
          notes: "Ticket closed from mobile workflow",
          payloadSnapshot: updatedPayload,
        });

        console.log("[Sync] Closed ticket", ticketId, "with markings");

        // Queue outbound event to 811 if this is an 811 ticket
        const outboundEventId = handleTicketClosure(db, ticketId, {
          closedByUserId,
          customerMarkings,
          closedByName: updatedPayload.closedByName || "Unknown",
          notes: updatedPayload.notes,
        });

        if (outboundEventId) {
          console.log("[Sync] Queued outbound 811 event:", outboundEventId);
        }

        const successResult = { requestId, status: "OK" };
        markEventProcessed(requestId, successResult);
        results.push(successResult);
      } else if (type === "TICKET_NOTE_ADDED") {
        const { ticketId, noteId, ticketNumber, authorId, authorName, body, noteType, createdAt } = payload;

        const ticket = db.prepare("SELECT id FROM tickets WHERE id = ?").get(ticketId);
        if (!ticket) {
          const errorResult = { requestId, status: "ERROR", error: "Ticket not found" };
          markEventProcessed(requestId, errorResult);
          results.push(errorResult);
          continue;
        }

        db.prepare(`
          INSERT OR IGNORE INTO ticket_notes (id, ticket_id, ticket_number, author_id, author_name, body, note_type, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          noteId,
          ticketId,
          ticketNumber || "",
          authorId || null,
          authorName || null,
          body || "",
          noteType || "INTERNAL",
          createdAt || Date.now(),
        );

        console.log(`[Sync] Saved note ${noteId} for ticket ${ticketId}`);
        emitOpsEvent("ticket.note.added", { ticketId, noteId, noteType, authorId });
        emitOpsEvent("ticket.updated", { ticketId });
        const successResult = { requestId, status: "OK" };
        markEventProcessed(requestId, successResult);
        results.push(successResult);
      } else if (type === "TICKET_ATTACHMENT_ADDED") {
        const {
          ticketId,
          attachmentId,
          ticketNumber,
          uploaderId,
          uploaderName,
          kind,
          fileName,
          mimeType,
          width,
          height,
          fileSize,
          lat,
          lng,
          dataBase64,
          capturedAt,
        } = payload;

        const ticket = db.prepare("SELECT id FROM tickets WHERE id = ?").get(ticketId);
        if (!ticket) {
          const errorResult = { requestId, status: "ERROR", error: "Ticket not found" };
          markEventProcessed(requestId, errorResult);
          results.push(errorResult);
          continue;
        }

        db.prepare(`
          INSERT OR IGNORE INTO ticket_attachments
          (id, ticket_id, ticket_number, uploader_id, uploader_name, kind, file_name, mime_type, width, height, file_size, lat, lng, data_base64, captured_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          attachmentId,
          ticketId,
          ticketNumber || "",
          uploaderId || null,
          uploaderName || null,
          kind || "PHOTO",
          fileName || null,
          mimeType || null,
          width || null,
          height || null,
          fileSize || null,
          typeof lat === "number" ? lat : null,
          typeof lng === "number" ? lng : null,
          dataBase64 || null,
          capturedAt || Date.now(),
        );

        console.log(`[Sync] Saved attachment ${attachmentId} for ticket ${ticketId}`);
        emitOpsEvent("ticket.attachment.added", { ticketId, attachmentId });
        emitOpsEvent("ticket.updated", { ticketId });
        const successResult = { requestId, status: "OK" };
        markEventProcessed(requestId, successResult);
        results.push(successResult);
      } else {
        console.log("[Sync] Unknown event type:", type);
        const ignoredResult = {
          requestId,
          status: "IGNORED",
          reason: "Unknown event type",
        };
        markEventProcessed(requestId, ignoredResult);
        results.push(ignoredResult);
      }
    } catch (error) {
      console.error("[Sync] Error processing event:", error.message);
      const errorResult = {
        requestId: event.requestId,
        status: "ERROR",
        error: error.message,
      };
      markEventProcessed(event.requestId, errorResult);
      results.push(errorResult);
    }
  }

  res.json({ results });
});

/**
 * POST /api/sync/process-outbound-811
 * Process pending outbound 811 events (for cron/manual trigger)
 */
router.post("/process-outbound-811", async (req, res) => {
  try {
    const results = await processOutbound811Events(db);
    res.json({
      success: true,
      ...results,
      message: `Processed ${results.processed} events, ${results.errors.length} errors`,
    });
  } catch (error) {
    console.error("[Sync] Failed to process outbound 811 events:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/sync/pull
 * Pull ticket changes since last sync
 */
router.post("/pull", (req, res) => {
  const { userId, lastSyncAt } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.status(404).json({ error: "user not found" });
  }

  // Use the shared territory-based visibility filter so techs get their tech
  // territories, supervisors get their supervisor territory, etc. Tickets
  // assigned directly to the user are always included (OR branch).
  const filter = buildTicketVisibilityFilter(db, user);
  let query = `SELECT * FROM tickets WHERE ${filter.sql}`;
  const params = [...filter.params];

  if (lastSyncAt) {
    query += " AND updated_at > ?";
    params.push(lastSyncAt);
  }

  query += " ORDER BY updated_at DESC";

  const tickets = db.prepare(query).all(...params);

  console.log(
    "[Sync] Pulling",
    tickets.length,
    "ticket deltas for user",
    userId,
    `(role=${user.role})`,
  );

  res.json({
    tickets: tickets.map((t) => ({
      ...t,
      payloadJson: t.payload_json,
    })),
    serverTime: Date.now(),
  });
});

/**
 * GET /api/sync/notes?ticketNumbers=A,B,C
 * Fetch all notes for one or more ticket numbers (for showing related ticket notes)
 */
router.get("/notes", (req, res) => {
  const { ticketNumbers, ticketId } = req.query;

  if (!ticketNumbers && !ticketId) {
    return res.status(400).json({ error: "ticketNumbers or ticketId required" });
  }

  let notes;
  if (ticketId) {
    notes = db.prepare(
      "SELECT * FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC"
    ).all(ticketId);
  } else {
    const numbers = String(ticketNumbers).split(",").map((s) => s.trim()).filter(Boolean);
    if (numbers.length === 0) {
      return res.json({ notes: [] });
    }
    const placeholders = numbers.map(() => "?").join(", ");
    notes = db.prepare(
      `SELECT * FROM ticket_notes WHERE ticket_number IN (${placeholders}) ORDER BY created_at ASC`
    ).all(...numbers);
  }

  res.json({ notes });
});

/**
 * GET /api/sync/attachments?ticketId=...&includeData=true
 * Returns metadata-only by default. Pass includeData=true to include base64 payload.
 */
router.get("/attachments", (req, res) => {
  const { ticketId, ticketNumbers, includeData } = req.query;

  if (!ticketId && !ticketNumbers) {
    return res.status(400).json({ error: "ticketId or ticketNumbers required" });
  }

  const columns = includeData === "true"
    ? "*"
    : "id, ticket_id, ticket_number, uploader_id, uploader_name, kind, file_name, mime_type, width, height, file_size, lat, lng, remote_url, captured_at, created_at";

  let rows;
  if (ticketId) {
    rows = db.prepare(
      `SELECT ${columns} FROM ticket_attachments WHERE ticket_id = ? ORDER BY captured_at ASC`,
    ).all(ticketId);
  } else {
    const numbers = String(ticketNumbers).split(",").map((s) => s.trim()).filter(Boolean);
    if (numbers.length === 0) {
      return res.json({ attachments: [] });
    }
    const placeholders = numbers.map(() => "?").join(", ");
    rows = db.prepare(
      `SELECT ${columns} FROM ticket_attachments WHERE ticket_number IN (${placeholders}) ORDER BY captured_at ASC`,
    ).all(...numbers);
  }

  res.json({ attachments: rows });
});

/**
 * GET /api/sync/attachments/:id
 * Returns full attachment record including base64 data (for image display on ops portal).
 */
router.get("/attachments/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM ticket_attachments WHERE id = ?").get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: "Attachment not found" });
  }
  res.json({ attachment: row });
});

export default router;
