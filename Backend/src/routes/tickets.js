import express from 'express';
import { db } from '../server.js';
import { canViewTicket, canEditTicket, ROLES, getTicketVisibilityFilter } from '../utils/permissions.js';
import {
  getChainByTicketId,
  getChainWithSummaries,
} from '../services/ticketChainService.js';

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

export default router;
