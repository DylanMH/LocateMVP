import { computeDueUrgency } from '../utils/dueUrgency.js';

/**
 * @typedef {Object} OpsMapMarker
 * @property {string} id
 * @property {number} lat
 * @property {number} lng
 * @property {string} ticketNumber
 * @property {string} [dueUrgency]
 * @property {string} locatorStatus
 * @property {string} [assignedTechName]
 * @property {boolean} isActive
 */

/**
 * Build an OpsMapMarker DTO from a ticket row.
 * @param {Object} ticket - tickets table row
 * @param {Object} [techLookup] - map of userId -> { id, name }
 * @returns {OpsMapMarker|null} null if ticket has no valid coordinates
 */
export function toOpsMapMarker(ticket, techLookup) {
  if (typeof ticket.lat !== 'number' || typeof ticket.lng !== 'number') return null;
  if (Number.isNaN(ticket.lat) || Number.isNaN(ticket.lng)) return null;
  if (!Number.isFinite(ticket.lat) || !Number.isFinite(ticket.lng)) return null;
  
  const isActive = ['ENROUTE', 'ONSITE', 'PAUSED'].includes(ticket.locator_status);
  const assignedTechName = ticket.assigned_tech_id && techLookup?.[ticket.assigned_tech_id]
    ? techLookup[ticket.assigned_tech_id].name
    : undefined;
  
  return {
    id: ticket.id,
    lat: ticket.lat,
    lng: ticket.lng,
    ticketNumber: ticket.ticket_number,
    dueUrgency: ticket.due_at ? computeDueUrgency(ticket.due_at) : undefined,
    locatorStatus: ticket.locator_status,
    assignedTechName,
    isActive,
  };
}
