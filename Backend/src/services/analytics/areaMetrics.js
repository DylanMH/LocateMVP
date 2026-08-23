import { summarizeTicketMetrics } from './ticketMetrics.js';
import {
  getTechIdsUnderTerritory,
  getSupervisorTerritoriesInArea,
  getSupervisorForTerritory,
} from '../territoryService.js';
import { computeSupervisorMetrics } from './supervisorMetrics.js';

/**
 * Compute area-level metrics: an aggregate for all techs under the area
 * territory, plus per-supervisor comparison rows for drilldown.
 *
 * @param {object} db
 * @param {string} areaTerritoryId - the AREA territory id
 * @param {number} startMs
 * @param {number} endMs
 * @returns {{ aggregate: object, supervisors: Array, area: object|null }}
 */
export function computeAreaMetrics(db, areaTerritoryId, startMs, endMs) {
  const area = db.prepare(`
    SELECT id, code, name FROM territories WHERE id = ? AND type = 'AREA'
  `).get(areaTerritoryId) || null;

  const techIds = getTechIdsUnderTerritory(db, areaTerritoryId);

  if (techIds.length === 0) {
    return {
      area: area ? { id: area.id, code: area.code, name: area.name } : null,
      aggregate: emptyAreaAggregate(),
      supervisors: [],
    };
  }

  const ph = techIds.map(() => '?').join(',');
  const tickets = db.prepare(`
    SELECT * FROM tickets
    WHERE assigned_tech_id IN (${ph})
      AND closed_at IS NOT NULL
      AND closed_at >= ?
      AND closed_at < ?
    ORDER BY closed_at ASC
  `).all(...techIds, startMs, endMs);

  const summary = summarizeTicketMetrics(tickets);

  // Open backlog
  const openRow = db.prepare(`
    SELECT COUNT(*) as c FROM tickets
    WHERE assigned_tech_id IN (${ph})
      AND locator_status NOT IN ('CLOSED','UNABLE')
  `).get(...techIds);

  // Overdue
  const now = Date.now();
  const overdueRow = db.prepare(`
    SELECT COUNT(*) as c FROM tickets
    WHERE assigned_tech_id IN (${ph})
      AND locator_status NOT IN ('CLOSED','UNABLE')
      AND due_at IS NOT NULL AND due_at > 0 AND due_at < ?
  `).get(...techIds, now);

  // Worked time
  const workedRow = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL AND clock_out_at > clock_in_at
          THEN MIN(clock_out_at, ?) - MAX(clock_in_at, ?)
        WHEN clock_in_at IS NOT NULL AND status = 'ACTIVE'
          THEN ? - MAX(clock_in_at, ?)
        ELSE 0
      END
    ), 0) as worked_ms
    FROM day_sessions
    WHERE user_id IN (${ph})
      AND (clock_in_at IS NOT NULL AND clock_in_at <= ?)
      AND (clock_out_at IS NULL OR clock_out_at >= ?)
  `).get(endMs, startMs, endMs, startMs, ...techIds, endMs, startMs);

  const workedMs = Math.max(0, workedRow.worked_ms || 0);
  const productiveHours = workedMs / 3600000;

  const aggregate = {
    techCount: techIds.length,
    completed: summary.completed,
    fullyClear: summary.fullyClear,
    fullyMarked: summary.fullyMarked,
    mixed: summary.mixed,
    markedTickets: summary.markedTickets,
    markedFootage: summary.markedFootage,
    cotp: summary.cotp,
    cotpNumerator: summary.cotpNumerator,
    cotpDenominator: summary.cotpDenominator,
    openBacklog: openRow.c || 0,
    overdue: overdueRow.c || 0,
    workedMs,
    workedHours: workedMs / 3600000,
    ticketsPerHour: productiveHours > 0 ? summary.completed / productiveHours : null,
    footagePerHour: productiveHours > 0 ? summary.markedFootage / productiveHours : null,
  };

  // Build supervisor comparison rows
  const supervisorTerritories = getSupervisorTerritoriesInArea(db, areaTerritoryId);
  const supervisors = supervisorTerritories.map((st) => {
    const sup = computeSupervisorMetrics(db, st.id, startMs, endMs);
    return {
      territoryId: st.id,
      territoryCode: st.code,
      territoryName: st.name,
      supervisor: sup.supervisor,
      techCount: sup.aggregate.techCount,
      completed: sup.aggregate.completed,
      fullyClear: sup.aggregate.fullyClear,
      fullyMarked: sup.aggregate.fullyMarked,
      mixed: sup.aggregate.mixed,
      markedFootage: sup.aggregate.markedFootage,
      cotp: sup.aggregate.cotp,
      cotpNumerator: sup.aggregate.cotpNumerator,
      cotpDenominator: sup.aggregate.cotpDenominator,
      clearRate: sup.aggregate.completed > 0
        ? { value: (sup.aggregate.fullyClear / sup.aggregate.completed) * 100, numerator: sup.aggregate.fullyClear, denominator: sup.aggregate.completed }
        : { value: null, numerator: 0, denominator: 0 },
      workedHours: sup.aggregate.workedHours,
      ticketsPerHour: sup.aggregate.ticketsPerHour,
      openBacklog: sup.aggregate.openBacklog,
      overdue: sup.aggregate.overdue,
    };
  });

  return {
    area: area ? { id: area.id, code: area.code, name: area.name } : null,
    aggregate,
    supervisors,
  };
}

function emptyAreaAggregate() {
  return {
    techCount: 0,
    completed: 0,
    fullyClear: 0,
    fullyMarked: 0,
    mixed: 0,
    markedTickets: 0,
    markedFootage: 0,
    cotp: null,
    cotpNumerator: 0,
    cotpDenominator: 0,
    openBacklog: 0,
    overdue: 0,
    workedMs: 0,
    workedHours: 0,
    ticketsPerHour: null,
    footagePerHour: null,
  };
}
