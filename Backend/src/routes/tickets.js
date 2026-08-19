import express from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../server.js';
import { canViewTicket, canEditTicket, ROLES, getTicketVisibilityFilter } from '../utils/permissions.js';
import {
  getChainByTicketId,
  getChainWithSummaries,
} from '../services/ticketChainService.js';
import { isEventProcessed, markEventProcessed, getProcessedEventResult } from '../services/idempotencyService.js';
import { queueOutbound811Event } from '../services/outbound811Service.js';
import { queueContractorEmail } from '../services/emailService.js';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'l720-ops-secret-key';

/**
 * Extract the authenticated user from a JWT Bearer token (used by portal)
 * or fall back to the x-user-id header / viewerId query param (used by mobile).
 */
function getAuthenticatedUser(req) {
  // Try JWT from Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(decoded.id);
      if (user) return user;
    } catch { /* invalid token — fall through */ }
  }
  // Fall back to viewerId / x-user-id (mobile dev)
  const userId = req.query.viewerId || req.headers['x-user-id'];
  if (userId) {
    return db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(userId) || null;
  }
  return null;
}

const router = express.Router();

// Serializer: include lineage columns alongside the existing columns so mobile
// and ops clients can render chain relationships without extra fetches.
function serializeTicket(t) {
  if (!t) return t;
  return {
    ...t,
    payloadJson: JSON.parse(t.payload_json || '{}'),
    rootTicketId: t.root_ticket_id,
    parentTicketId: t.parent_ticket_id,
    sequenceNumber: t.sequence_number,
    externalRootNumber: t.external_root_number,
  };
}

/**
 * Helper to get user from request (supports JWT auth or query param for dev)
 */
function getUserFromRequest(req) {
  // If JWT auth is available (from ops middleware), use it
  if (req.user) return req.user;

  // Fallback: lookup by userId query param (for dev/mobile testing)
  const userId = req.query.viewerId || req.headers['x-user-id'];
  if (userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return user;
  }
  return null;
}

/**
 * GET /api/tickets
 * Get all tickets with optional filters
 * Permission-based: filters by user role and visibility
 */
router.get('/', (req, res) => {
  const { assignedTo, status, locatorStatus } = req.query;
  const viewer = getUserFromRequest(req);

  let query = 'SELECT * FROM tickets WHERE 1=1';
  const params = [];

  // Apply permission-based filtering via the territory model (roles determine
  // what, territories determine where). See services/territoryService.js.
  if (viewer) {
    const filter = getTicketVisibilityFilter(db, viewer);
    query += ` AND ${filter.sql}`;
    params.push(...filter.params);
  }

  if (assignedTo) {
    query += ' AND assigned_tech_id = ?';
    params.push(assignedTo);
  }

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  if (locatorStatus) {
    query += ' AND locator_status = ?';
    params.push(locatorStatus);
  }

  query += ' ORDER BY due_at ASC';

  const tickets = db.prepare(query).all(...params);

  res.json({
    tickets: tickets.map(serializeTicket),
  });
});

/**
 * GET /api/tickets/:id
 * Get a single ticket by ID
 * Permission-based: checks user can view the ticket
 */
router.get('/:id', (req, res) => {
  const viewer = getUserFromRequest(req);
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);

  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  // Check permissions if viewer is provided
  if (viewer && !canViewTicket(viewer, ticket, db)) {
    return res.status(403).json({ error: 'Access denied - you cannot view this ticket' });
  }

  res.json(serializeTicket(ticket));
});

/**
 * GET /api/tickets/:id/history
 * Return the full ordered chain (original + all linked tickets) sharing a
 * root. Independent per-ticket fields remain independent \u2014 this endpoint
 * does NOT aggregate time, footage, notes, or photos.
 */
router.get('/:id/history', (req, res) => {
  const viewer = getUserFromRequest(req);
  const anchor = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!anchor) return res.status(404).json({ error: 'Ticket not found' });
  if (viewer && !canViewTicket(viewer, anchor, db)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const chain = getChainByTicketId(db, req.params.id).filter((t) => {
    if (!viewer) return true;
    return canViewTicket(viewer, t, db);
  });
  res.json({ chain: chain.map(serializeTicket) });
});

/**
 * GET /api/tickets/:id/related
 * Same chain as /history but with the current ticket excluded. Convenience
 * for the mobile \"Related Tickets\" panel.
 */
router.get('/:id/related', (req, res) => {
  const viewer = getUserFromRequest(req);
  const anchor = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!anchor) return res.status(404).json({ error: 'Ticket not found' });
  if (viewer && !canViewTicket(viewer, anchor, db)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const related = getChainByTicketId(db, req.params.id)
    .filter((t) => t.id !== req.params.id)
    .filter((t) => (viewer ? canViewTicket(viewer, t, db) : true));
  res.json({ related: related.map(serializeTicket) });
});

/**
 * GET /api/tickets/:id/chain-summary
 * Chain with small per-ticket operational summaries (minutes, footage per
 * ticket). Still ticket-scoped \u2014 never aggregated.
 */
router.get('/:id/chain-summary', (req, res) => {
  const viewer = getUserFromRequest(req);
  const anchor = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!anchor) return res.status(404).json({ error: 'Ticket not found' });
  if (viewer && !canViewTicket(viewer, anchor, db)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json({ chain: getChainWithSummaries(db, req.params.id) });
});

/**
 * POST /api/tickets - DISABLED
 * Ticket creation disabled for 811 integration
 * Tickets will be ingested from 811 Simulator
 */
router.post('/', (req, res) => {
  res.status(503).json({ 
    error: 'Ticket creation disabled', 
    message: 'Tickets are now ingested from 811 Simulator' 
  });
});

/**
 * PATCH /api/tickets/:id
 * Update a ticket (status, assignment, etc.)
 * Permission-based: checks user can edit the ticket
 */
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const viewer = getUserFromRequest(req);

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  // Check edit permissions if viewer is provided
  if (viewer && !canEditTicket(viewer, ticket, db)) {
    return res.status(403).json({ error: 'Access denied - you cannot edit this ticket' });
  }
  
  const allowedFields = [
    'status',
    'locator_status',
    'assigned_tech_id',
    'payload_json',
  ];
  
  const setClauses = [];
  const params = [];
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      const dbField = field === 'locatorStatus' ? 'locator_status' :
                      field === 'assignedTechId' ? 'assigned_tech_id' :
                      field === 'payloadJson' ? 'payload_json' :
                      field;
      setClauses.push(`${dbField} = ?`);
      params.push(typeof updates[field] === 'object' ? JSON.stringify(updates[field]) : updates[field]);
    }
  }
  
  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }
  
  setClauses.push('updated_at = ?');
  params.push(Date.now());
  
  setClauses.push('version = version + 1');
  
  params.push(id);
  
  const query = `UPDATE tickets SET ${setClauses.join(', ')} WHERE id = ?`;
  db.prepare(query).run(...params);
  
  const updatedTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  
  res.json({
    ...updatedTicket,
    payloadJson: JSON.parse(updatedTicket.payload_json),
  });
});

/**
 * GET /api/tickets/stats/summary
 * Get ticket statistics
 */
router.get('/stats/summary', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM tickets').get().count;
  const open = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status = 'OPEN'").get().count;
  const closed = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status = 'CLOSED'").get().count;
  
  const byLocatorStatus = db.prepare(`
    SELECT locator_status, COUNT(*) as count
    FROM tickets
    GROUP BY locator_status
  `).all();
  
  res.json({
    total,
    open,
    closed,
    byLocatorStatus: byLocatorStatus.reduce((acc, row) => {
      acc[row.locator_status] = row.count;
      return acc;
    }, {}),
  });
});

/**
 * POST /api/tickets/:id/reschedule
 * Reschedule a single ticket's due date.
 *
 * - Preserves original_due_at (set on first reschedule)
 * - Appends to ticket_reschedules history table
 * - Updates due_at and version on the ticket
 * - Queues an outbound 811 event (TICKET_DUE_REVISED)
 * - Idempotent via request_id
 *
 * Body: { newDueAt, requestId, reason?, reasonCode?, extensionType?,
 *          approvalName?, approvalPhone?, approverUserId?,
 *          excavatorResponse?, notes?, source? }
 */
router.post('/:id/reschedule', (req, res) => {
  const { id } = req.params;
  const {
    newDueAt, reason, requestId, approverUserId, notes,
    reasonCode, extensionType, approvalName, approvalPhone,
    excavatorResponse, source,
  } = req.body;

  if (!newDueAt || typeof newDueAt !== 'number') {
    return res.status(400).json({ error: 'newDueAt (number) required' });
  }
  if (!requestId || typeof requestId !== 'string') {
    return res.status(400).json({ error: 'requestId required for idempotency' });
  }

  // Idempotency check
  if (isEventProcessed(requestId)) {
    const cached = getProcessedEventResult(requestId);
    return res.json(cached);
  }

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!ticket) {
    const result = { requestId, status: 'ERROR', error: 'Ticket not found' };
    markEventProcessed(requestId, result);
    return res.status(404).json(result);
  }

  // Identify who is performing the reschedule
  const performedBy = getAuthenticatedUser(req);
  const performedByUserId = performedBy?.id || null;
  const performedByName = performedBy?.name || performedBy?.username || null;

  const previousDueAt = ticket.due_at;
  const originalDueAt = ticket.original_due_at ?? previousDueAt;
  const now = Date.now();
  const rescheduleId = crypto.randomUUID();

  const tx = db.transaction(() => {
    // Update ticket due_at and preserve original_due_at
    db.prepare(`
      UPDATE tickets
      SET due_at = ?, original_due_at = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(newDueAt, originalDueAt, now, id);

    // Append to reschedule history
    db.prepare(`
      INSERT INTO ticket_reschedules (
        id, ticket_id, previous_due_at, new_due_at, reason, reason_code,
        extension_type, approval_name, approval_phone,
        approver_user_id, performed_by_user_id, excavator_response,
        eight_one_one_revision_state, source, notes, request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rescheduleId, id, previousDueAt, newDueAt, reason || null,
      reasonCode || null, extensionType || null,
      approvalName || null, approvalPhone || null,
      approverUserId || null, performedByUserId, excavatorResponse || null,
      source === 'L720_INTERNAL' ? 'N/A' : 'PENDING',
      source || 'L720_INTERNAL', notes || null, requestId, now,
    );

    // Queue outbound 811 event only for 811-sourced reschedules
    if (ticket.external_ticket_id && source !== 'L720_INTERNAL') {
      queueOutbound811Event(db, {
        ticketId: id,
        externalTicketId: ticket.external_ticket_id,
        eventType: 'TICKET_DUE_REVISED',
        payload: {
          notes: JSON.stringify({
            previousDueAt,
            newDueAt,
            originalDueAt,
            reason,
            reasonCode,
            source: source || '811_UPDATE',
            remark: source === '811_UPDATE_REMARK',
          }),
        },
      });
    }

    // Queue contractor email notification with the notes/message
    let contractorEmail = null;
    try {
      const payload = JSON.parse(ticket.payload_json || '{}');
      contractorEmail = payload.contactEmail || payload.contact_email || null;
    } catch { /* ignore */ }

    if (contractorEmail) {
      const previousDate = new Date(previousDueAt).toLocaleString();
      const newDate = new Date(newDueAt).toLocaleString();
      const emailBody = notes
        ? notes
        : `Ticket ${ticket.ticket_number} is being rescheduled due to ${reason || 'operational needs'} to ${newDate}. The technician will complete the locate as soon as possible.\n\nPrevious due: ${previousDate}\nNew due: ${newDate}`;
      queueContractorEmail(db, {
        ticketId: id,
        contractorEmail,
        subject: `Ticket ${ticket.ticket_number} Due Date Rescheduled`,
        body: emailBody,
      });
    }
  });

  try {
    tx();
    const result = {
      requestId,
      status: 'OK',
      ticketId: id,
      previousDueAt,
      newDueAt,
      originalDueAt,
      rescheduleId,
      performedByUserId,
      performedByName,
    };
    markEventProcessed(requestId, result);
    console.log(`[Tickets] Rescheduled ${id}: due ${previousDueAt} -> ${newDueAt} by ${performedByName || performedByUserId || 'unknown'}`);
    res.json(result);
  } catch (error) {
    console.error('[Tickets] Reschedule failed:', error.message);
    const result = { requestId, status: 'ERROR', error: error.message };
    markEventProcessed(requestId, result);
    res.status(500).json(result);
  }
});

/**
 * POST /api/tickets/reschedule-bulk
 * Reschedule multiple tickets from the same contractor.
 *
 * Body: { ticketIds: string[], newDueAt, requestId, reason?, reasonCode?,
 *          extensionType?, approvalName?, approvalPhone?, approverUserId?,
 *          excavatorResponse?, notes?, source? }
 * Rejects if tickets belong to different contractors.
 */
router.post('/reschedule-bulk', (req, res) => {
  const {
    ticketIds, newDueAt, reason, requestId, approverUserId,
    reasonCode, extensionType, approvalName, approvalPhone,
    excavatorResponse, notes, source,
  } = req.body;

  if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
    return res.status(400).json({ error: 'ticketIds (non-empty array) required' });
  }
  if (!newDueAt || typeof newDueAt !== 'number') {
    return res.status(400).json({ error: 'newDueAt (number) required' });
  }
  if (!requestId || typeof requestId !== 'string') {
    return res.status(400).json({ error: 'requestId required for idempotency' });
  }

  if (isEventProcessed(requestId)) {
    const cached = getProcessedEventResult(requestId);
    return res.json(cached);
  }

  // Fetch all tickets and verify same contractor
  const placeholders = ticketIds.map(() => '?').join(',');
  const tickets = db.prepare(`SELECT * FROM tickets WHERE id IN (${placeholders})`).all(...ticketIds);

  if (tickets.length !== ticketIds.length) {
    const found = new Set(tickets.map((t) => t.id));
    const missing = ticketIds.filter((tid) => !found.has(tid));
    const result = { requestId, status: 'ERROR', error: `Tickets not found: ${missing.join(', ')}` };
    markEventProcessed(requestId, result);
    return res.status(404).json(result);
  }

  // Check contractor consistency
  const contractors = new Set(
    tickets.map((t) => {
      try {
        const payload = JSON.parse(t.payload_json || '{}');
        return payload.contractor || payload.contractorName || null;
      } catch {
        return null;
      }
    }),
  );
  if (contractors.size > 1) {
    const result = {
      requestId,
      status: 'ERROR',
      error: 'Cannot reschedule tickets from different contractors',
      contractors: Array.from(contractors),
    };
    markEventProcessed(requestId, result);
    return res.status(400).json(result);
  }

  // Identify who is performing the bulk reschedule
  const performedBy = getAuthenticatedUser(req);
  const performedByUserId = performedBy?.id || null;

  const now = Date.now();
  const results = [];

  const tx = db.transaction(() => {
    for (const ticket of tickets) {
      const previousDueAt = ticket.due_at;
      const originalDueAt = ticket.original_due_at ?? previousDueAt;
      const rescheduleId = crypto.randomUUID();
      const perRequestId = `${requestId}:${ticket.id}`;

      db.prepare(`
        UPDATE tickets
        SET due_at = ?, original_due_at = ?, version = version + 1, updated_at = ?
        WHERE id = ?
      `).run(newDueAt, originalDueAt, now, ticket.id);

      db.prepare(`
        INSERT INTO ticket_reschedules (
          id, ticket_id, previous_due_at, new_due_at, reason, reason_code,
          extension_type, approval_name, approval_phone,
          approver_user_id, performed_by_user_id, excavator_response,
          eight_one_one_revision_state, source, notes, request_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rescheduleId, ticket.id, previousDueAt, newDueAt, reason || null,
        reasonCode || null, extensionType || null,
        approvalName || null, approvalPhone || null,
        approverUserId || null, performedByUserId, excavatorResponse || null,
        source === 'L720_INTERNAL' ? 'N/A' : 'PENDING',
        source || 'L720_INTERNAL', notes || null, perRequestId, now,
      );

      if (ticket.external_ticket_id && source !== 'L720_INTERNAL') {
        queueOutbound811Event(db, {
          ticketId: ticket.id,
          externalTicketId: ticket.external_ticket_id,
          eventType: 'TICKET_DUE_REVISED',
          payload: {
            notes: JSON.stringify({
              previousDueAt,
              newDueAt,
              originalDueAt,
              reason,
              reasonCode,
              source: source || '811_UPDATE',
              remark: source === '811_UPDATE_REMARK',
            }),
          },
        });
      }

      // Queue contractor email for bulk reschedules too
      let contractorEmail = null;
      try {
        const payload = JSON.parse(ticket.payload_json || '{}');
        contractorEmail = payload.contactEmail || payload.contact_email || null;
      } catch { /* ignore */ }

      if (contractorEmail) {
        const previousDate = new Date(previousDueAt).toLocaleString();
        const newDate = new Date(newDueAt).toLocaleString();
        const emailBody = notes
          ? notes
          : `Ticket ${ticket.ticket_number} is being rescheduled due to ${reason || 'operational needs'} to ${newDate}. The technician will complete the locate as soon as possible.\n\nPrevious due: ${previousDate}\nNew due: ${newDate}`;
        queueContractorEmail(db, {
          ticketId: ticket.id,
          contractorEmail,
          subject: `Ticket ${ticket.ticket_number} Due Date Rescheduled`,
          body: emailBody,
        });
      }

      results.push({
        ticketId: ticket.id,
        previousDueAt,
        newDueAt,
        originalDueAt,
        rescheduleId,
      });
    }
  });

  try {
    tx();
    const result = {
      requestId,
      status: 'OK',
      rescheduledCount: results.length,
      results,
    };
    markEventProcessed(requestId, result);
    console.log(`[Tickets] Bulk rescheduled ${results.length} tickets to due ${newDueAt}`);
    res.json(result);
  } catch (error) {
    console.error('[Tickets] Bulk reschedule failed:', error.message);
    const result = { requestId, status: 'ERROR', error: error.message };
    markEventProcessed(requestId, result);
    res.status(500).json(result);
  }
});

/**
 * GET /api/tickets/:id/reschedules
 * Get reschedule history for a ticket.
 */
router.get('/:id/reschedules', (req, res) => {
  const { id } = req.params;
  const history = db.prepare(`
    SELECT
      tr.*,
      u.name as performed_by_name,
      u.username as performed_by_username
    FROM ticket_reschedules tr
    LEFT JOIN users u ON u.id = tr.performed_by_user_id
    WHERE tr.ticket_id = ?
    ORDER BY tr.created_at DESC
  `).all(id);
  res.json({ ticketId: id, reschedules: history });
});

export default router;
