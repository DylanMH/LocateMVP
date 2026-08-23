import { summarizeTicketMetrics } from './ticketMetrics.js';
import { getTechIdsUnderTerritory } from '../territoryService.js';

/**
 * Compute per-technician metrics for a set of tech IDs over a time range.
 * Each row includes the tech's identity, ticket outcome metrics, and
 * COTP numerator/denominator so sorting does not depend on rounded values.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {string[]} techIds - tech user IDs to compute metrics for
 * @param {number} startMs - range start (inclusive)
 * @param {number} endMs - range end (exclusive)
 * @returns {Array<object>} per-tech metric rows
 */
export function computePerTechMetrics(db, techIds, startMs, endMs) {
  if (techIds.length === 0) return [];

  const results = [];
  for (const techId of techIds) {
    const user = db.prepare(`
      SELECT id, name, email, role FROM users WHERE id = ?
    `).get(techId);
    if (!user) continue;

    const tickets = db.prepare(`
      SELECT * FROM tickets
      WHERE assigned_tech_id = ?
        AND closed_at IS NOT NULL
        AND closed_at >= ?
        AND closed_at < ?
      ORDER BY closed_at ASC
    `).all(techId, startMs, endMs);

    const metrics = summarizeTicketMetrics(tickets);

    // Open backlog for this tech
    const openCount = db.prepare(`
      SELECT COUNT(*) as c FROM tickets
      WHERE assigned_tech_id = ?
        AND locator_status NOT IN ('CLOSED','UNABLE')
    `).get(techId).c;

    // Overdue count
    const now = Date.now();
    const openTickets = db.prepare(`
      SELECT due_at FROM tickets
      WHERE assigned_tech_id = ?
        AND locator_status NOT IN ('CLOSED','UNABLE')
        AND due_at IS NOT NULL
    `).all(techId);
    let overdue = 0;
    for (const t of openTickets) {
      if (Number(t.due_at) > 0 && Number(t.due_at) < now) overdue += 1;
    }

    // Worked minutes in range (from day_sessions)
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
      WHERE user_id = ?
        AND (clock_in_at IS NOT NULL AND clock_in_at <= ?)
        AND (clock_out_at IS NULL OR clock_out_at >= ?)
    `).get(endMs, startMs, endMs, startMs, techId, endMs, startMs);

    const workedMs = Math.max(0, workedRow.worked_ms || 0);
    const productiveHours = workedMs / 3600000;

    results.push({
      techId: user.id,
      techName: user.name,
      techEmail: user.email,
      role: user.role,
      openBacklog: openCount,
      overdue,
      completed: metrics.completed,
      fullyClear: metrics.fullyClear,
      fullyMarked: metrics.fullyMarked,
      mixed: metrics.mixed,
      markedTickets: metrics.markedTickets,
      markedFootage: metrics.markedFootage,
      cotp: metrics.cotp,
      cotpNumerator: metrics.cotpNumerator,
      cotpDenominator: metrics.cotpDenominator,
      clearRate: metrics.completed > 0
        ? { value: (metrics.fullyClear / metrics.completed) * 100, numerator: metrics.fullyClear, denominator: metrics.completed }
        : { value: null, numerator: 0, denominator: 0 },
      workedMs,
      workedHours: workedMs / 3600000,
      ticketsPerHour: productiveHours > 0 ? metrics.completed / productiveHours : null,
      footagePerHour: productiveHours > 0 ? metrics.markedFootage / productiveHours : null,
    });
  }
  return results;
}

/**
 * Compute supervisor team metrics: an aggregate for all techs under the
 * supervisor territory, plus per-tech child summaries for drilldown.
 *
 * @param {object} db
 * @param {string} supervisorTerritoryId - the SUPERVISOR_TERRITORY id
 * @param {number} startMs
 * @param {number} endMs
 * @returns {{ aggregate: object, techs: Array, supervisor: object|null }}
 */
export function computeSupervisorMetrics(db, supervisorTerritoryId, startMs, endMs) {
  const techIds = getTechIdsUnderTerritory(db, supervisorTerritoryId);

  // Resolve supervisor user
  const supervisor = db.prepare(`
    SELECT u.id, u.name, u.email FROM users u
    JOIN user_territory_assignments uta ON uta.user_id = u.id
    WHERE uta.territory_id = ?
      AND uta.assignment_type IN ('OWNER','MANAGER')
      AND (uta.end_date IS NULL OR uta.end_date > ?)
      AND u.is_active = 1
      AND u.role = 'SUPERVISOR'
    LIMIT 1
  `).get(supervisorTerritoryId, Date.now()) || null;

  if (techIds.length === 0) {
    return {
      supervisor: supervisor ? {
        id: supervisor.id, name: supervisor.name, email: supervisor.email,
      } : null,
      aggregate: {
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
      },
      techs: [],
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

  // Open backlog across all techs
  const openRow = db.prepare(`
    SELECT COUNT(*) as c FROM tickets
    WHERE assigned_tech_id IN (${ph})
      AND locator_status NOT IN ('CLOSED','UNABLE')
  `).get(...techIds);

  // Overdue count
  const now = Date.now();
  const overdueRow = db.prepare(`
    SELECT COUNT(*) as c FROM tickets
    WHERE assigned_tech_id IN (${ph})
      AND locator_status NOT IN ('CLOSED','UNABLE')
      AND due_at IS NOT NULL AND due_at > 0 AND due_at < ?
  `).get(...techIds, now);

  // Worked time across all techs
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

  const techs = computePerTechMetrics(db, techIds, startMs, endMs);

  return {
    supervisor: supervisor ? {
      id: supervisor.id, name: supervisor.name, email: supervisor.email,
    } : null,
    aggregate,
    techs,
  };
}
