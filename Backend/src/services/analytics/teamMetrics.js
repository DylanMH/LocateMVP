import { summarizeTicketMetrics } from './ticketMetrics.js';

export function emptyTeamMetrics() {
  return {
    completed: 0,
    fullyClear: 0,
    fullyMarked: 0,
    mixed: 0,
    markedTickets: 0,
    markedFootage: 0,
    cotp: null,
    cotpNumerator: 0,
    cotpDenominator: 0,
    techCount: 0,
  };
}

export function computeTeamMetrics(db, techIds = [], startMs, endMs) {
  if (techIds.length === 0) return emptyTeamMetrics();

  const placeholders = techIds.map(() => '?').join(',');
  const tickets = db.prepare(`
    SELECT * FROM tickets
    WHERE assigned_tech_id IN (${placeholders})
      AND closed_at IS NOT NULL
      AND closed_at >= ?
      AND closed_at < ?
    ORDER BY closed_at ASC
  `).all(...techIds, startMs, endMs);

  return {
    ...summarizeTicketMetrics(tickets),
    techCount: techIds.length,
  };
}
