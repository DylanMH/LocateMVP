/**
 * Ingestion Service - Pulls tickets from 811 Simulator and stores them in L720
 */

import { resolveTerritoryChainForPoint } from './territoryService.js';

const ELEVEN_SIM_BASE_URL = 'http://localhost:4100';
const MAX_811_PULL_LIMIT = 500;

function getStableAccountNumber(source = {}) {
  return (
    source.accountNumber ||
    source.account_number ||
    source.memberCode ||
    source.member_code ||
    source.id ||
    ''
  );
}

/**
 * Pull new/updated tickets from 811 Simulator since given timestamp
 * @param {Object} db - Database instance
 * @param {number} since - Timestamp in milliseconds (optional, defaults to 0)
 * @param {Object} options - Pull behavior options
 * @returns {Object} - { ingested: number, updated: number, errors: string[] }
 */
export async function pullTicketsFrom811(db, since = 0, options = {}) {
  const { reconcileMissing = false } = options;
  const results = {
    ingested: 0,
    updated: 0,
    reconciledRemoved: 0,
    warnings: [],
    errors: []
  };

  try {
    console.log(`[Ingestion] Pulling tickets from 811 since ${new Date(since).toISOString()}`);

    // Fetch tickets from 811 Simulator
    const response = await fetch(
      `${ELEVEN_SIM_BASE_URL}/api/811/tickets?since=${since}&memberCode=USIC&limit=${MAX_811_PULL_LIMIT}`,
    );
    
    if (!response.ok) {
      throw new Error(`811 Simulator returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const tickets = data.tickets || [];

    console.log(`[Ingestion] Received ${tickets.length} tickets from 811 Simulator`);

    if (reconcileMissing && tickets.length === MAX_811_PULL_LIMIT) {
      const warning = `811 reconcile pulled ${MAX_811_PULL_LIMIT} tickets and may be truncated; missing-ticket reconciliation may be incomplete`;
      console.warn(`[Ingestion] ${warning}`);
      results.warnings.push(warning);
    }

    // Process each ticket
    for (const ticket811 of tickets) {
      try {
        const result = await upsert811Ticket(db, ticket811);
        if (result === 'INGESTED') {
          results.ingested++;
        } else if (result === 'UPDATED') {
          results.updated++;
        }
      } catch (error) {
        console.error(`[Ingestion] Failed to process ticket ${ticket811.id}:`, error.message);
        results.errors.push(`Ticket ${ticket811.id}: ${error.message}`);
      }
    }

    if (reconcileMissing) {
      results.reconciledRemoved = reconcileMissing811Tickets(db, tickets);
    }

    console.log(
      `[Ingestion] Complete: ${results.ingested} ingested, ${results.updated} updated, ${results.reconciledRemoved} reconciled-removed, ${results.errors.length} errors`,
    );

  } catch (error) {
    console.error('[Ingestion] Failed to pull from 811 Simulator:', error.message);
    results.errors.push(`Network error: ${error.message}`);
  }

  return results;
}

function deleteTicketCascade(db, ticketId) {
  const deleteTicketEvents = db.prepare(`
    DELETE FROM ticket_events
    WHERE ticket_id = ?
  `);
  const deleteOutboundEvents = db.prepare(`
    DELETE FROM outbox_811_events
    WHERE ticket_id = ?
  `);
  const deleteClockEvents = db.prepare(`
    DELETE FROM clock_events
    WHERE ticket_id = ?
  `);
  const clearClockOutTicketReferences = db.prepare(`
    UPDATE day_sessions
    SET clock_out_ticket_id = NULL
    WHERE clock_out_ticket_id = ?
  `);
  const deleteUtilityProduction = db.prepare(`
    DELETE FROM utility_production_ledger
    WHERE ticket_id = ?
  `);
  const deleteTicketNotes = db.prepare(`
    DELETE FROM ticket_notes
    WHERE ticket_id = ?
  `);
  const deleteTicketAttachments = db.prepare(`
    DELETE FROM ticket_attachments
    WHERE ticket_id = ?
  `);
  const deleteTicket = db.prepare(`
    DELETE FROM tickets
    WHERE id = ?
  `);

  deleteTicketEvents.run(ticketId);
  deleteOutboundEvents.run(ticketId);
  deleteClockEvents.run(ticketId);
  clearClockOutTicketReferences.run(ticketId);
  deleteUtilityProduction.run(ticketId);
  deleteTicketNotes.run(ticketId);
  deleteTicketAttachments.run(ticketId);
  deleteTicket.run(ticketId);
}

function reconcileMissing811Tickets(db, current811Tickets) {
  const activeExternalIds = new Set(current811Tickets.map((ticket) => ticket.id));

  const existing811Tickets = db.prepare(`
    SELECT id, ticket_number, external_ticket_id
    FROM tickets
    WHERE source = '811' AND external_ticket_id IS NOT NULL
  `).all();

  let removedCount = 0;

  const tx = db.transaction(() => {
    for (const ticket of existing811Tickets) {
      if (activeExternalIds.has(ticket.external_ticket_id)) {
        continue;
      }

      deleteTicketCascade(db, ticket.id);

      console.log(
        `[Ingestion] Deleted stale 811 ticket ${ticket.ticket_number} (${ticket.id}) because it no longer exists in the source`,
      );
      removedCount += 1;
    }
  });

  tx();
  return removedCount;
}

/**
 * Upsert an 811 ticket into L720 database
 * @param {Object} db - Database instance  
 * @param {Object} ticket811 - Ticket from 811 Simulator
 * @returns {string} - 'INGESTED', 'UPDATED', or 'SKIPPED'
 */
export async function upsert811Ticket(db, ticket811) {
  // Check if ticket already exists
  const existing = db.prepare('SELECT * FROM tickets WHERE external_ticket_id = ?').get(ticket811.id);

  // Conflict resolution: skip if we have pending local changes
  if (existing && hasPendingLocalChanges(db, existing.id)) {
    console.log(`[Ingestion] Skipping ticket ${ticket811.id} - has pending local changes`);
    return 'SKIPPED';
  }

  // Map 811 ticket to L720 ticket structure
  const existingPayload = existing?.payload_json ? JSON.parse(existing.payload_json || '{}') : {};
  const l720Ticket = map811TicketToL720(ticket811, existingPayload);

  // Resolve lineage (see docs/linked-tickets-architecture.md).
  // 811 IDs are external; we need to map them to local L720 ticket ids.
  // If the parent/root hasn't been ingested yet (out-of-order pull), we leave
  // parent_ticket_id NULL and root_ticket_id pointing at self, and repair on a
  // later pull once the parent exists.
  const lineage = resolveLineage(db, ticket811, existing);

  // Resolve the territory chain from lat/lng. Territory is a pure function of
  // location + territory tree, so we recompute on every ingest — cheap and
  // self-healing if the tree is edited later.
  const chain = resolveTerritoryChainForPoint(db, l720Ticket.lat, l720Ticket.lng);

  if (existing) {
    // Update existing ticket (only 811 fields, preserve L720 workflow fields)
    // Lineage fields are immutable once set — only fill in if missing, never overwrite.
    //
    // Rescheduling guard: if the ticket has been locally rescheduled
    // (original_due_at IS NOT NULL), don't overwrite due_at with the
    // incoming 811 value unless the 811 simulator has actually revised
    // the due date (detected by comparing incoming due_at to original_due_at;
    // if they differ, the simulator has revised it and we accept the new value).
    const updateStmt = db.prepare(`
      UPDATE tickets
      SET ticket_number = ?, ticket_type = ?, address = ?, lat = ?, lng = ?,
          due_at = CASE
            WHEN original_due_at IS NOT NULL AND ? = original_due_at THEN due_at
            ELSE ?
          END,
          original_due_at = COALESCE(original_due_at, ?),
          payload_json = ?, last_811_sync_at = ?,
          updated_at = ?,
          root_ticket_id = COALESCE(root_ticket_id, ?),
          parent_ticket_id = COALESCE(parent_ticket_id, ?),
          sequence_number = COALESCE(sequence_number, ?),
          external_root_number = COALESCE(external_root_number, ?),
          district_territory_id = ?,
          area_territory_id = ?,
          supervisor_territory_id = ?,
          tech_territory_id = ?
      WHERE id = ?
    `);

    updateStmt.run(
      l720Ticket.ticket_number,
      l720Ticket.ticket_type,
      l720Ticket.address,
      l720Ticket.lat,
      l720Ticket.lng,
      l720Ticket.due_at,
      l720Ticket.due_at,
      l720Ticket.due_at,
      l720Ticket.payload_json,
      Date.now(), // last_811_sync_at
      Date.now(), // updated_at
      lineage.rootTicketId || existing.id,
      lineage.parentTicketId,
      lineage.sequenceNumber || 1,
      lineage.externalRootNumber || l720Ticket.ticket_number,
      chain.district_territory_id,
      chain.area_territory_id,
      chain.supervisor_territory_id,
      chain.tech_territory_id,
      existing.id,
    );

    // Repair pass: if this ticket was previously a placeholder root (self-rooted)
    // because its real parent hadn't arrived yet, AND we can now resolve the
    // parent, fix it up.
    repairPendingLineage(db, existing.id, ticket811, lineage);

    console.log(`[Ingestion] Updated ticket ${ticket811.id} -> ${existing.id}`);
    return 'UPDATED';
  } else {
    // Insert new ticket
    const insertStmt = db.prepare(`
      INSERT INTO tickets (
        id, ticket_number, ticket_type, address, lat, lng, status, locator_status,
        assigned_tech_id, due_at, created_at, updated_at, version, payload_json,
        source, external_ticket_id, last_811_sync_at,
        root_ticket_id, parent_ticket_id, sequence_number, external_root_number,
        district_territory_id, area_territory_id, supervisor_territory_id, tech_territory_id
      ) VALUES (
        @id, @ticketNumber, @ticketType, @address, @lat, @lng, @status, @locatorStatus,
        @assignedTechId, @dueAt, @createdAt, @updatedAt, @version, @payloadJson,
        @source, @externalTicketId, @last811SyncAt,
        @rootTicketId, @parentTicketId, @sequenceNumber, @externalRootNumber,
        @districtTerritoryId, @areaTerritoryId, @supervisorTerritoryId, @techTerritoryId
      )
    `);

    const ticketId = `ticket-${generateTicketId()}`;

    // If 811 says this is an ORIGINAL (or lineage is missing), self-root locally.
    // Otherwise use the resolved root. The parent may still be NULL if it hasn't
    // been ingested yet — that's fine; repairPendingLineage handles it later.
    const rootTicketId = lineage.rootTicketId || ticketId;
    
    const ticketData = {
      id: ticketId,
      ticketNumber: l720Ticket.ticket_number,
      ticketType: l720Ticket.ticket_type,
      address: l720Ticket.address,
      lat: l720Ticket.lat,
      lng: l720Ticket.lng,
      status: 'OPEN',
      locatorStatus: 'PENDING',   // awaiting tech assignment
      assignedTechId: null,       // will be set by assignment service
      dueAt: l720Ticket.due_at,
      createdAt: l720Ticket.created_at,
      updatedAt: l720Ticket.updated_at,
      version: 1,
      payloadJson: l720Ticket.payload_json,
      source: '811',
      externalTicketId: ticket811.id,
      last811SyncAt: Date.now(),
      rootTicketId,
      parentTicketId: lineage.parentTicketId,
      sequenceNumber: lineage.sequenceNumber || 1,
      externalRootNumber: lineage.externalRootNumber || l720Ticket.ticket_number,
      districtTerritoryId: chain.district_territory_id,
      areaTerritoryId: chain.area_territory_id,
      supervisorTerritoryId: chain.supervisor_territory_id,
      techTerritoryId: chain.tech_territory_id,
    };
    
    insertStmt.run(ticketData);

    // If this ticket turns out to be a root that previously-ingested children
    // pointed to by external_root_number, fix their root_ticket_id now.
    adoptOrphanedChildren(db, ticketId, ticket811);

    console.log(`[Ingestion] Ingested ticket ${ticket811.id} -> ${ticketId} (root=${rootTicketId}, seq=${ticketData.sequenceNumber})`);
    return 'INGESTED';
  }
}

/**
 * Resolve the lineage of an incoming 811 ticket to local L720 ticket ids.
 * Returns { rootTicketId, parentTicketId, sequenceNumber, externalRootNumber }.
 * rootTicketId and parentTicketId are null if unresolvable right now (caller
 * will fall back to self-rooting and we'll repair on a subsequent pull).
 */
function resolveLineage(db, ticket811, existing) {
  const payload = parsePayload(ticket811);
  const external = ticket811 || {};

  const externalRootId = external.rootTicketId || payload.rootTicketId || null;
  const externalParentId = external.parentTicketId || payload.parentTicketId || null;
  const sequenceNumber =
    Number(external.sequenceNumber || payload.sequenceNumber || 1) || 1;
  const externalRootNumber =
    external.externalRootNumber ||
    payload.externalRootNumber ||
    external.ticketNumber ||
    null;

  // Resolve local ids for the external references.
  let rootTicketId = null;
  if (externalRootId) {
    if (externalRootId === ticket811.id) {
      // Self is root — use the local id we already have (existing row) or null for
      // insert path (caller will set it to the new ticketId).
      rootTicketId = existing ? existing.id : null;
    } else {
      const rootRow = db
        .prepare('SELECT id FROM tickets WHERE external_ticket_id = ?')
        .get(externalRootId);
      rootTicketId = rootRow?.id || null;
    }
  }

  let parentTicketId = null;
  if (externalParentId) {
    const parentRow = db
      .prepare('SELECT id FROM tickets WHERE external_ticket_id = ?')
      .get(externalParentId);
    parentTicketId = parentRow?.id || null;
  }

  return { rootTicketId, parentTicketId, sequenceNumber, externalRootNumber };
}

function parsePayload(ticket811) {
  if (ticket811?.payload && typeof ticket811.payload === 'object') return ticket811.payload;
  if (typeof ticket811?.payloadJson === 'string') {
    try { return JSON.parse(ticket811.payloadJson); } catch { /* ignore */ }
  }
  return {};
}

/**
 * If an existing ticket currently self-roots (root_ticket_id == id) but 811
 * now tells us about a real parent, fix up root/parent links.
 */
function repairPendingLineage(db, localTicketId, ticket811, lineage) {
  if (!lineage.rootTicketId && !lineage.parentTicketId) return;
  const row = db
    .prepare('SELECT id, root_ticket_id, parent_ticket_id FROM tickets WHERE id = ?')
    .get(localTicketId);
  if (!row) return;

  const shouldFixRoot =
    lineage.rootTicketId && row.root_ticket_id !== lineage.rootTicketId;
  const shouldFixParent =
    lineage.parentTicketId && row.parent_ticket_id !== lineage.parentTicketId;

  if (!shouldFixRoot && !shouldFixParent) return;

  db.prepare(
    `UPDATE tickets
     SET root_ticket_id = COALESCE(?, root_ticket_id),
         parent_ticket_id = COALESCE(?, parent_ticket_id)
     WHERE id = ?`,
  ).run(
    shouldFixRoot ? lineage.rootTicketId : null,
    shouldFixParent ? lineage.parentTicketId : null,
    localTicketId,
  );
  console.log(`[Ingestion] Repaired lineage for ${localTicketId}`);
}

/**
 * After inserting a ticket, check if any previously-ingested tickets had it
 * as their external root but could not resolve it locally. Fix those up.
 */
function adoptOrphanedChildren(db, newLocalId, ticket811) {
  const externalRootId = ticket811.id;
  const externalRootNumber =
    ticket811.externalRootNumber || ticket811.ticketNumber || null;
  if (!externalRootId) return;

  // Children whose external root matches this ticket but whose local
  // root_ticket_id still points at themselves (placeholder).
  const orphans = db
    .prepare(
      `SELECT t.id FROM tickets t
       WHERE t.root_ticket_id = t.id
         AND t.external_root_number = ?
         AND t.id != ?
         AND t.external_ticket_id != ?`,
    )
    .all(externalRootNumber, newLocalId, externalRootId);

  if (orphans.length === 0) return;
  const update = db.prepare(
    `UPDATE tickets SET root_ticket_id = ? WHERE id = ?`,
  );
  const tx = db.transaction(() => {
    for (const o of orphans) update.run(newLocalId, o.id);
  });
  tx();
  console.log(
    `[Ingestion] Adopted ${orphans.length} orphaned children under root ${newLocalId}`,
  );
}

/**
 * Map 811 ticket structure to L720 ticket structure
 * @param {Object} ticket811 - Ticket from 811 Simulator
 * @param {Object} existingPayload - Existing payload from L720 database
 * @returns {Object} - L720 ticket object
 */
function map811TicketToL720(ticket811, existingPayload = {}) {
  let parsedPayload = {};
  if (ticket811.payload && typeof ticket811.payload === 'object') {
    parsedPayload = ticket811.payload;
  } else if (ticket811.payloadJson && typeof ticket811.payloadJson === 'string') {
    try {
      parsedPayload = JSON.parse(ticket811.payloadJson || '{}');
    } catch (error) {
      console.warn(`[Ingestion] Failed to parse payloadJson for 811 ticket ${ticket811.id}:`, error.message);
    }
  }

  // Extract customers from 811 payload or members
  let customers = [];
  
  if (parsedPayload.customers && Array.isArray(parsedPayload.customers)) {
    // Map 811 payload customers to L720 customer format
    customers = parsedPayload.customers.map(customer => ({
      id: customer.id,
      name: customer.name,
      utility: customer.utility,
      accountNumber: getStableAccountNumber(customer)
    }));
  } else if (ticket811.members) {
    // Map 811 members to customers
    customers = ticket811.members.map(member => ({
      id: member.id,
      name: member.customerName || member.companyName || member.company_name || member.utility || member.utilityType || member.utility_type,
      utility: member.utility || member.utilityType || member.utility_type,
      accountNumber: getStableAccountNumber(member)
    }));
  }

  const preservedCustomerMarking = existingPayload.customerMarkings || existingPayload.customerMarking || {};
  const originalTicketData = {
    ...(existingPayload.originalTicketData || {}),
    ...ticket811,
    payload: parsedPayload,
  };

  // Build L720 payload
  const payloadJson = {
    ...existingPayload,
    customers,
    customerMarkings: preservedCustomerMarking,
    scope: parsedPayload.scope || existingPayload.scope || null,
    workType: parsedPayload.workType || ticket811.workType || existingPayload.workType || 'Standard Locate',
    contractor: parsedPayload.contractor || ticket811.contractor?.name || existingPayload.contractor || 'Unknown',
    contractorPhone: parsedPayload.contractorPhone || ticket811.contractor?.phone || existingPayload.contractorPhone || '',
    contactName: parsedPayload.contactName || ticket811.contractor?.contact?.name || existingPayload.contactName || '',
    contactEmail: parsedPayload.contactEmail || ticket811.contractor?.contact?.email || existingPayload.contactEmail || '',
    markingInstructions: parsedPayload.markingInstructions || ticket811.markingInstructions || existingPayload.markingInstructions || '',
    // Preserve original 811 data for reference
    externalSource: '811_SIMULATOR',
    originalTicketData
  };

  // 811-standard ticket type. "Original" is a lineage concept (root of a
  // chain), not a type — see docs/linked-tickets-architecture.md. Default to
  // NORMAL when the source omits a type.
  const incomingType = ticket811.ticketType || 'NORMAL';

  return {
    ticket_number: ticket811.ticketNumber,
    ticket_type: incomingType,
    address: ticket811.address,
    lat: ticket811.lat,
    lng: ticket811.lng,
    due_at: ticket811.dueAt,
    created_at: ticket811.createdAt,
    updated_at: ticket811.updatedAt,
    payload_json: JSON.stringify(payloadJson),
  };
}

/**
 * Check if ticket has pending local changes that should block 811 overwrites.
 *
 * Heuristic: a ticket is "active on mobile" if the locator_status is in a
 * field-work state (ENROUTE, ONSITE, PAUSED), meaning a tech is actively
 * working it and their local device holds the source of truth.
 *
 * We also check for a recent (last 5 min) mobile-sourced ticket_event to
 * catch the window right after a status change syncs.
 *
 * @param {Object} db - Database instance
 * @param {string} ticketId - L720 ticket ID
 * @returns {boolean} - True if pending/active local changes exist
 */
function hasPendingLocalChanges(db, ticketId) {
  const ticket = db.prepare(
    "SELECT locator_status FROM tickets WHERE id = ?"
  ).get(ticketId);
  if (!ticket) return false;

  // States where the tech's device holds the source of truth and 811
  // re-ingestion must NOT overwrite any field.  CLOSED/UNABLE are included
  // because the closure data (closedByName, closedAt, customerMarkings)
  // originates from the mobile and must be preserved permanently — not just
  // for the 5-minute recent-event window.
  const activeStates = new Set(["ENROUTE", "ONSITE", "PAUSED", "CLOSED", "UNABLE"]);
  if (activeStates.has(ticket.locator_status)) return true;

  // Check for recent mobile-sourced events (last 5 minutes).
  const recentMobileEvent = db.prepare(`
    SELECT 1 FROM ticket_events
    WHERE ticket_id = ?
      AND event_type IN ('TICKET_STATUS_SET', 'TICKET_CUSTOMER_MARKING_SET', 'TICKET_CLOSED')
      AND created_at > ?
    LIMIT 1
  `).get(ticketId, Date.now() - 5 * 60 * 1000);

  return Boolean(recentMobileEvent);
}

/**
 * Generate simple ticket ID
 * @returns {string} - Random ID
 */
function generateTicketId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

/**
 * Get last sync timestamp for 811 ingestion
 * @param {Object} db - Database instance
 * @returns {number} - Timestamp in milliseconds
 */
export function getLast811SyncTimestamp(db) {
  const result = db.prepare(`
    SELECT MAX(last_811_sync_at) as last_sync 
    FROM tickets 
    WHERE source = '811'
  `).get();

  return result?.last_sync || 0;
}
