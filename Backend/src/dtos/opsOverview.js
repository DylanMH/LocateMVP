/**
 * @typedef {Object} OpsOverview
 * @property {{ totalTechs: number, clockedIn: number, enroute: number, onsite: number, paused: number, onLunch: number, onPersonal: number }} techs
 * @property {{ open: number, overdue: number, dueSoon: number, completedToday: number, totalFootageToday: number, highPriority: number }} tickets
 * @property {Array} needsAttention - array of { type, id, label, detail }
 * @property {Array} activeTechs - array of TechOpsSummary for techs currently clocked in
 * @property {{ totalWorkedMinutes: number, totalCompletedTickets: number, totalFootage: number, openBacklog: number }} teamSummary
 */

/**
 * Build an OpsOverview DTO from computed metrics.
 */
export function toOpsOverview(metrics) {
  return {
    techs: metrics.techs,
    tickets: metrics.tickets,
    needsAttention: metrics.needsAttention || [],
    activeTechs: metrics.activeTechs || [],
    teamSummary: metrics.teamSummary,
  };
}
