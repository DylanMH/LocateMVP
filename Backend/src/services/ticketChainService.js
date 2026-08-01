/**
 * Ticket Chain Service.
 *
 * Read-only helpers for the linked-ticket / history model. See
 * docs/linked-tickets-architecture.md.
 *
 * BUSINESS RULE: chain reads NEVER aggregate time, footage, notes, or photos
 * across tickets. Each row is still an independent operational ticket. This
 * service only walks lineage relationships; productivity queries live in their
 * own ticket-scoped services.
 */

/**
 * Return the full ordered chain for any ticket in a chain.
 * Sorted by sequence_number ASC then created_at ASC.
 */
export function getChainByTicketId(db, ticketId) {
  const anchor = db
    .prepare('SELECT root_ticket_id FROM tickets WHERE id = ?')
    .get(ticketId);
  if (!anchor) return [];
  const rootId = anchor.root_ticket_id || ticketId;
  return db
    .prepare(
      `SELECT * FROM tickets
       WHERE root_ticket_id = ?
       ORDER BY sequence_number ASC, created_at ASC`,
    )
    .all(rootId);
}

/**
 * Return the chain that shares an external root ticket number across the 811
 * system. Useful when searching by base ticket number across the whole chain.
 */
export function getChainByExternalRootNumber(db, externalRootNumber) {
  if (!externalRootNumber) return [];
  return db
    .prepare(
      `SELECT * FROM tickets
       WHERE external_root_number = ?
       ORDER BY sequence_number ASC, created_at ASC`,
    )
    .all(externalRootNumber);
}

/** Return the latest (highest sequence_number) ticket in a chain. */
export function getLatestInChain(db, anyTicketIdOrRootId) {
  const anchor = db
    .prepare('SELECT root_ticket_id FROM tickets WHERE id = ?')
    .get(anyTicketIdOrRootId);
  const rootId = anchor?.root_ticket_id || anyTicketIdOrRootId;
  return db
    .prepare(
      `SELECT * FROM tickets
       WHERE root_ticket_id = ?
       ORDER BY sequence_number DESC, created_at DESC
       LIMIT 1`,
    )
    .get(rootId);
}

/**
 * Return the chain with a small per-ticket operational summary. This is a
 * read-only join that reports productivity PER TICKET and never rolls up.
 */
export function getChainWithSummaries(db, ticketId) {
  const rows = getChainByTicketId(db, ticketId);
  if (rows.length === 0) return [];
  const productionStmt = db.prepare(
    `SELECT COALESCE(SUM(minutes_delta), 0) AS minutes,
            COALESCE(SUM(footage_delta), 0) AS footage
     FROM utility_production_ledger WHERE ticket_id = ?`,
  );
  const techStmt = db.prepare('SELECT id, name, area_id FROM users WHERE id = ?');
  return rows.map((t) => {
    const prod = productionStmt.get(t.id) || { minutes: 0, footage: 0 };
    const tech = t.assigned_tech_id ? techStmt.get(t.assigned_tech_id) : null;
    return {
      id: t.id,
      ticketNumber: t.ticket_number,
      ticketType: t.ticket_type,
      status: t.status,
      locatorStatus: t.locator_status,
      address: t.address,
      dueAt: t.due_at,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      closedAt: t.closed_at,
      rootTicketId: t.root_ticket_id,
      parentTicketId: t.parent_ticket_id,
      sequenceNumber: t.sequence_number,
      externalRootNumber: t.external_root_number,
      assignedTech: tech
        ? { id: tech.id, name: tech.name, areaId: tech.area_id }
        : null,
      // Per-ticket totals \u2014 never summed across the chain.
      minutes: prod.minutes,
      footage: prod.footage,
    };
  });
}
