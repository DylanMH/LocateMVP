import { computeDueUrgency } from '../utils/dueUrgency.js';

/**
 * @typedef {Object} TechOpsSummary
 * @property {string} id
 * @property {string} name
 * @property {string} [employeeId]
 * @property {string} areaId
 * @property {string} timesheetState
 * @property {string} [ticketState]
 * @property {number} [currentSessionStartedAt]
 * @property {{ id: string, ticketNumber: string, address: string, locatorStatus: string, dueAt?: number, dueUrgency?: string }} [activeTicket]
 * @property {{ workedMinutes: number, completedTickets: number, footageFeet: number }} today
 * @property {{ open: number, overdue: number, dueSoon: number }} assigned
 * @property {number} [lastActivityAt]
 */

/**
 * Build a TechOpsSummary DTO.
 * @param {Object} user - users table row
 * @param {Object} liveClockState - from getLiveClockState()
 * @param {Object} productivity - from computeTechProductivity() or computeUserProductivity()
 * @param {Object} [activeTicket] - tickets table row or null
 * @param {Object} assignedCounts - { open, overdue, dueSoon }
 * @param {number} [lastActivityAt]
 * @returns {TechOpsSummary}
 */
export function toTechOpsSummary(user, liveClockState, productivity, activeTicket, assignedCounts, lastActivityAt) {
  const now = Date.now();
  return {
    id: user.id,
    name: user.name,
    employeeId: user.employee_id || undefined,
    areaId: user.area_id || undefined,
    timesheetState: liveClockState?.clockStatus || 'CLOCKED_OUT',
    ticketState: activeTicket?.locator_status || undefined,
    currentSessionStartedAt: liveClockState?.currentSession?.clockInAt || undefined,
    activeTicket: activeTicket ? {
      id: activeTicket.id,
      ticketNumber: activeTicket.ticket_number,
      address: activeTicket.address || undefined,
      locatorStatus: activeTicket.locator_status,
      dueAt: activeTicket.due_at || undefined,
      dueUrgency: activeTicket.due_at ? computeDueUrgency(activeTicket.due_at, now) : undefined,
    } : undefined,
    today: {
      workedMinutes: Math.round((productivity?.workedMs || 0) / 60000),
      completedTickets: productivity?.ticketsClosedInRange || 0,
      footageFeet: productivity?.footage || 0,
    },
    assigned: {
      open: assignedCounts?.open || 0,
      overdue: assignedCounts?.overdue || 0,
      dueSoon: assignedCounts?.dueSoon || 0,
    },
    lastActivityAt: lastActivityAt || undefined,
  };
}
