import { summarizeTicketMetrics } from './ticketMetrics.js';
import {
  getTechIdsUnderTerritory,
  getAreaTerritoriesInDistrict,
} from '../territoryService.js';
import { computeAreaMetrics } from './areaMetrics.js';

/**
 * Compute district-level metrics: an aggregate for all techs under the
 * district territory, plus per-area comparison rows for drilldown.
 *
 * @param {object} db
 * @param {string} districtTerritoryId - the DISTRICT territory id
 * @param {number} startMs
 * @param {number} endMs
 * @returns {{ aggregate: object, areas: Array, district: object|null }}
 */
export function computeDistrictMetrics(db, districtTerritoryId, startMs, endMs) {
  const district = db.prepare(`
    SELECT id, code, name FROM territories WHERE id = ? AND type = 'DISTRICT'
  `).get(districtTerritoryId) || null;

  const techIds = getTechIdsUnderTerritory(db, districtTerritoryId);

  if (techIds.length === 0) {
    return {
      district: district ? { id: district.id, code: district.code, name: district.name } : null,
      aggregate: emptyDistrictAggregate(),
      areas: [],
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

  // Build area comparison rows
  const areaTerritories = getAreaTerritoriesInDistrict(db, districtTerritoryId);
  const areas = areaTerritories.map((at) => {
    const am = computeAreaMetrics(db, at.id, startMs, endMs);
    return {
      territoryId: at.id,
      territoryCode: at.code,
      territoryName: at.name,
      techCount: am.aggregate.techCount,
      completed: am.aggregate.completed,
      fullyClear: am.aggregate.fullyClear,
      fullyMarked: am.aggregate.fullyMarked,
      mixed: am.aggregate.mixed,
      markedFootage: am.aggregate.markedFootage,
      cotp: am.aggregate.cotp,
      cotpNumerator: am.aggregate.cotpNumerator,
      cotpDenominator: am.aggregate.cotpDenominator,
      clearRate: am.aggregate.completed > 0
        ? { value: (am.aggregate.fullyClear / am.aggregate.completed) * 100, numerator: am.aggregate.fullyClear, denominator: am.aggregate.completed }
        : { value: null, numerator: 0, denominator: 0 },
      workedHours: am.aggregate.workedHours,
      ticketsPerHour: am.aggregate.ticketsPerHour,
      openBacklog: am.aggregate.openBacklog,
      overdue: am.aggregate.overdue,
    };
  });

  return {
    district: district ? { id: district.id, code: district.code, name: district.name } : null,
    aggregate,
    areas,
  };
}

function emptyDistrictAggregate() {
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
