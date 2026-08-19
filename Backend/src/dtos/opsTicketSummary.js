import { computeDueUrgency } from '../utils/dueUrgency.js';

/**
 * @typedef {Object} OpsTicketSummary
 * @property {string} id
 * @property {string} ticketNumber
 * @property {string} [address]
 * @property {string} [areaId]
 * @property {{ id: string, name: string }} [assignedTech]
 * @property {string} ticketType
 * @property {string} status
 * @property {string} locatorStatus
 * @property {number} [dueAt]
 * @property {string} [dueUrgency]
 * @property {{ total: number, completed: number }} customers
 * @property {{ onsiteMinutes: number, allocatedMinutes: number, remainingMinutes: number }} [allocation]
 */

/**
 * Build an OpsTicketSummary DTO from a ticket row.
 * @param {Object} ticket - tickets table row (with payload_json)
 * @param {Object} [techLookup] - map of userId -> { id, name } for assigned techs
 * @returns {OpsTicketSummary}
 */
export function toOpsTicketSummary(ticket, techLookup) {
  const now = Date.now();
  let payload = {};
  try { payload = JSON.parse(ticket.payload_json || '{}'); } catch { payload = {}; }
  
  const customers = Array.isArray(payload.customers) ? payload.customers : [];
  const customerMarkings = payload.customerMarkings || {};
  const completed = customers.filter(c => customerMarkings[c.id]?.completed).length;
  
  let allocation;
  if (payload.customerMarkings) {
    const allocatedMinutes = Object.values(customerMarkings).reduce((sum, m) => sum + (Number(m.minutes) || 0), 0);
    // onsiteMinutes would come from time allocation computation if available
    allocation = {
      onsiteMinutes: 0, // filled by caller if time allocation computed
      allocatedMinutes,
      remainingMinutes: 0, // filled by caller
    };
  }
  
  const assignedTech = ticket.assigned_tech_id && techLookup?.[ticket.assigned_tech_id]
    ? { id: ticket.assigned_tech_id, name: techLookup[ticket.assigned_tech_id].name }
    : undefined;
  
  return {
    id: ticket.id,
    ticketNumber: ticket.ticket_number,
    address: ticket.address || undefined,
    areaId: ticket.area_territory_id || undefined,
    assignedTech,
    ticketType: ticket.ticket_type || undefined,
    status: ticket.status,
    locatorStatus: ticket.locator_status,
    dueAt: ticket.due_at || undefined,
    dueUrgency: ticket.due_at ? computeDueUrgency(ticket.due_at, now) : undefined,
    customers: {
      total: customers.length,
      completed,
    },
    allocation,
  };
}
