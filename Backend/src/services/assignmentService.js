/**
 * Assignment Service — assigns tickets to techs based on tech_territory.
 *
 * Tech territories live in the territories table. Tech-to-territory links
 * live in user_territory_assignments(assignment_type='TECH_ASSIGNMENT').
 *
 * A ticket is always routed to its tech_territory_id (set by the
 * ingestionService via territoryService.resolveTerritoryChainForPoint).
 * If nobody is assigned to that territory, the ticket falls back to the
 * supervisor who owns the supervisor_territory so no ticket sits unassigned.
 */

import {
  pickTechForTerritory,
  pickSupervisorForTerritory,
} from './territoryService.js';

/**
 * Assign a ticket to a user by their id.
 * @returns {Object} - { success, assignedUserId?, assignedUserName?, error? }
 */
function assignTicketToUser(db, ticketId, userId, userName) {
  db.prepare(`
    UPDATE tickets
    SET assigned_tech_id = ?,
        locator_status = CASE WHEN locator_status = 'PENDING' THEN 'ASSIGNED' ELSE locator_status END,
        updated_at = ?,
        version = version + 1
    WHERE id = ?
  `).run(userId, Date.now(), ticketId);
  return { success: true, assignedTechId: userId, assignedTechName: userName };
}

/**
 * Assign a ticket to a tech in its tech_territory (by territory id).
 * Falls back to the supervisor if no tech covers the territory.
 * @returns {Object} - { success, assignedTechId?, assignedTechName?, error? }
 */
export function assignTicketToTechTerritory(db, ticketId, techTerritoryId, supervisorTerritoryId) {
  try {
    if (!techTerritoryId) {
      return { success: false, error: 'No tech_territory_id resolved for ticket' };
    }
    const tech = pickTechForTerritory(db, techTerritoryId);
    if (tech) {
      const r = assignTicketToUser(db, ticketId, tech.id, tech.name);
      console.log(`[Assignment] Assigned ticket ${ticketId} to tech ${tech.name} (${tech.id}) in ${techTerritoryId}`);
      return r;
    }

    // No tech in this territory — fall back to supervisor.
    if (supervisorTerritoryId) {
      const supe = pickSupervisorForTerritory(db, supervisorTerritoryId);
      if (supe) {
        const r = assignTicketToUser(db, ticketId, supe.id, supe.name);
        console.log(`[Assignment] Assigned ticket ${ticketId} to supervisor ${supe.name} (${supe.id}) — no tech in ${techTerritoryId}`);
        return r;
      }
    }

    return { success: false, error: `No techs in territory ${techTerritoryId} and no supervisor found` };
  } catch (error) {
    console.error(`[Assignment] Failed to assign ticket ${ticketId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Back-compat shim. The old signature took a raw area code (e.g. 'ROCKWALL');
 * we now map that to a tech_territory id.
 */
export function assignTicketToArea(db, ticketId, areaCode) {
  const techTerritoryId = `terr-tech-${String(areaCode || '').toLowerCase()}`;
  return assignTicketToTechTerritory(db, ticketId, techTerritoryId);
}

/**
 * Assign every unassigned ticket by its tech_territory_id (set at ingestion).
 * Only assigns tickets where assigned_tech_id IS NULL — never overrides an
 * existing assignment, even if it was a supervisor fallback. Manual
 * assignments by supervisors must be respected.
 * @returns {{ assigned: number, errors: string[] }}
 */
export function assignUnassignedTickets(db) {
  const results = { assigned: 0, errors: [] };

  const unassigned = db.prepare(`
    SELECT id, tech_territory_id, supervisor_territory_id
    FROM tickets
    WHERE assigned_tech_id IS NULL
      AND locator_status NOT IN ('CLOSED','UNABLE')
  `).all();

  console.log(`[Assignment] Found ${unassigned.length} unassigned tickets`);

  for (const t of unassigned) {
    if (!t.tech_territory_id) {
      results.errors.push(`Ticket ${t.id}: no tech_territory_id resolved`);
      continue;
    }
    const r = assignTicketToTechTerritory(db, t.id, t.tech_territory_id, t.supervisor_territory_id);
    if (r.success) results.assigned++;
    else results.errors.push(`Ticket ${t.id}: ${r.error}`);
  }

  console.log(`[Assignment] Complete: ${results.assigned} assigned, ${results.errors.length} errors`);
  return results;
}

/**
 * Tech / open-ticket counts grouped by tech_territory.
 */
export function getAssignmentStats(db) {
  const rows = db.prepare(`
    SELECT t.id AS territory_id, t.code AS territory_code, t.name AS territory_name
    FROM territories t WHERE t.type = 'TECH_TERRITORY' AND t.active = 1
  `).all();

  const techCountByTerritory = db.prepare(`
    SELECT territory_id, COUNT(DISTINCT user_id) AS cnt
    FROM user_territory_assignments
    WHERE assignment_type = 'TECH_ASSIGNMENT'
    GROUP BY territory_id
  `).all().reduce((a, r) => (a[r.territory_id] = r.cnt, a), {});

  const ticketCountByTerritory = db.prepare(`
    SELECT tech_territory_id, COUNT(*) AS total,
           SUM(CASE WHEN locator_status NOT IN ('CLOSED','UNABLE') THEN 1 ELSE 0 END) AS open
    FROM tickets
    WHERE tech_territory_id IS NOT NULL
    GROUP BY tech_territory_id
  `).all().reduce((a, r) => (a[r.tech_territory_id] = r, a), {});

  const stats = {};
  for (const r of rows) {
    const tc = ticketCountByTerritory[r.territory_id] || { total: 0, open: 0 };
    stats[r.territory_code] = {
      techs: techCountByTerritory[r.territory_id] || 0,
      openTickets: tc.open || 0,
      totalTickets: tc.total || 0,
    };
  }
  return stats;
}
