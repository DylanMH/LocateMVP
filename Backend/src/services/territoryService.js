import { findTechTerritoryForPoint as findTechTerritoryFromBoundaryUnits } from '../db/boundaryUnits.js';

/**
 * Territory Service — single source of truth for:
 *   1. Resolving a (lat, lng) to the 4-level territory chain
 *   2. Building the visibility SQL filter for a given user
 *   3. Returning the list of territories a user can "see"
 *
 * All routes and background services should go through this module instead
 * of hand-rolling area/tech checks. See user spec in AGENTS.md.
 */

/**
 * Return the 4-level territory chain for a point. Any level may be null if
 * the point falls outside a known tech territory or the tree is incomplete.
 *
 * @returns {{
 *   district_territory_id: string|null,
 *   area_territory_id: string|null,
 *   supervisor_territory_id: string|null,
 *   tech_territory_id: string|null,
 * }}
 */
export function resolveTerritoryChainForPoint(db, lat, lng) {
  const empty = {
    district_territory_id: null,
    area_territory_id: null,
    supervisor_territory_id: null,
    tech_territory_id: null,
  };
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return empty;
  }

  // First try: find by coverage_json (more precise) or bbox
  const tech = findTechTerritoryForPoint(db, lat, lng);

  if (!tech) return empty;
  return { ...walkUp(db, tech.id), tech_territory_id: tech.id };
}

/**
 * Find the best matching TECH_TERRITORY for a point.
 * First checks coverage_json for cities/counties, then falls back to bbox,
 * then falls back to nearest tech territory by centroid distance.
 */
function findTechTerritoryForPoint(db, lat, lng) {
  const boundaryUnitMatch = findTechTerritoryFromBoundaryUnits(db, lat, lng);
  if (boundaryUnitMatch) return boundaryUnitMatch;

  // Get all active tech territories
  const techTerritories = db.prepare(`
    SELECT id, coverage_json, bbox_north, bbox_south, bbox_east, bbox_west,
           center_lat, center_lng
    FROM territories
    WHERE type = 'TECH_TERRITORY' AND active = 1
  `).all();

  for (const t of techTerritories) {
    // Check coverage_json first if present
    if (t.coverage_json) {
      try {
        const coverage = JSON.parse(t.coverage_json);
        // Check if point is in covered cities (approximate - city points with buffer)
        if (coverage.cities?.length > 0) {
          const cityMatch = checkPointInCities(db, lat, lng, coverage.cities);
          if (cityMatch) return t;
        }
        // Check if point is in covered counties (bbox-based for now)
        if (coverage.counties?.length > 0) {
          const countyMatch = checkPointInCounties(db, lat, lng, coverage.counties);
          if (countyMatch) return t;
        }
      } catch {
        // Invalid JSON, fall through to bbox
      }
    }

    // Fallback to bbox check
    if (t.bbox_north !== null && t.bbox_south !== null && t.bbox_east !== null && t.bbox_west !== null) {
      if (lat >= t.bbox_south && lat <= t.bbox_north && lng >= t.bbox_west && lng <= t.bbox_east) {
        return t;
      }
    }
  }

  // Final fallback: nearest tech territory by centroid distance.
  // This catches tickets generated slightly outside a city's Census bbox
  // (the simulator uses a wider service-area bbox than the actual city
  // boundary). Only tech territories with a centroid are considered.
  let nearest = null;
  let nearestDist = Infinity;
  for (const t of techTerritories) {
    if (t.center_lat == null || t.center_lng == null) continue;
    const dist = Math.pow(t.center_lat - lat, 2) + Math.pow(t.center_lng - lng, 2);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = t;
    }
  }

  return nearest;
}

function checkPointInCities(db, lat, lng, cityNames) {
  if (!cityNames?.length) return false;

  const cities = db.prepare(`
    SELECT geometry_geojson
    FROM boundary_units
    WHERE type = 'city'
      AND name IN (${cityNames.map(() => '?').join(',')})
      AND ? BETWEEN bbox_south AND bbox_north
      AND ? BETWEEN bbox_west AND bbox_east
  `).all(...cityNames, lat, lng);

  for (const city of cities) {
    try {
      const geometry = city.geometry_geojson ? JSON.parse(city.geometry_geojson) : null;
      if (pointInGeometry(lat, lng, geometry)) return true;
    } catch {
      // Ignore malformed geometry rows.
    }
  }

  return false;
}

function checkPointInCounties(db, lat, lng, countyFips) {
  // Check against county bboxes
  const placeholders = countyFips.map(() => '?').join(',');
  const counties = db.prepare(`
    SELECT fips FROM geo_counties
    WHERE fips IN (${placeholders})
      AND ? BETWEEN bbox_south AND bbox_north
      AND ? BETWEEN bbox_west AND bbox_east
  `).all(...countyFips, lat, lng);

  return counties.length > 0;
}

/**
 * Walk the parent chain up from a tech territory id and return the
 * supervisor/area/district ids.
 */
function walkUp(db, techTerritoryId) {
  const out = {
    district_territory_id: null,
    area_territory_id: null,
    supervisor_territory_id: null,
  };
  let row = db.prepare(`SELECT id, type, parent_territory_id FROM territories WHERE id = ?`).get(techTerritoryId);
  // Start from the parent of the tech territory
  row = row?.parent_territory_id
    ? db.prepare(`SELECT id, type, parent_territory_id FROM territories WHERE id = ?`).get(row.parent_territory_id)
    : null;
  while (row) {
    if (row.type === 'SUPERVISOR_TERRITORY') out.supervisor_territory_id = row.id;
    else if (row.type === 'AREA') out.area_territory_id = row.id;
    else if (row.type === 'DISTRICT') out.district_territory_id = row.id;
    row = row.parent_territory_id
      ? db.prepare(`SELECT id, type, parent_territory_id FROM territories WHERE id = ?`).get(row.parent_territory_id)
      : null;
  }
  return out;
}

/**
 * Return the set of territory ids the user has direct assignments to,
 * grouped by type.
 */
export function getUserDirectTerritories(db, userId) {
  const rows = db.prepare(`
    SELECT t.id, t.type, uta.assignment_type
    FROM user_territory_assignments uta
    JOIN territories t ON t.id = uta.territory_id
    WHERE uta.user_id = ?
      AND (uta.end_date IS NULL OR uta.end_date > ?)
  `).all(userId, Date.now());

  const out = { DISTRICT: [], AREA: [], SUPERVISOR_TERRITORY: [], TECH_TERRITORY: [] };
  for (const r of rows) if (out[r.type]) out[r.type].push(r.id);
  return out;
}

/**
 * Build a ticket-visibility SQL fragment for the given user.
 * Returns { sql: string, params: any[] }. `sql` is always of the form
 * "(<predicate>)" or "1=1" / "1=0", suitable for AND-ing into a WHERE clause.
 *
 * Visibility rules (roles determine WHAT, territories determine WHERE):
 *   DISTRICT_MANAGER    -> everything
 *   AREA_MANAGER       -> tickets whose area_territory_id is in user's AREA assignments
 *                         (or, legacy fallback: district)
 *   SUPERVISOR         -> tickets whose supervisor_territory_id is in user's
 *                         SUPERVISOR_TERRITORY OWNER/MANAGER assignments
 *                         OR tickets assigned directly to the supervisor
 *   TRAINER/TECH/TRAINEE -> tickets whose tech_territory_id is in user's
 *                         TECH_TERRITORY assignments OR assigned_tech_id = user.id
 *   (unknown role)     -> only assigned_tech_id = user.id (safe default)
 */
export function buildTicketVisibilityFilter(db, user) {
  if (!user) return { sql: '1=0', params: [] };

  const role = user.role;
  if (role === 'DISTRICT_MANAGER') return { sql: '1=1', params: [] };

  const dir = getUserDirectTerritories(db, user.id);

  if (role === 'DISTRICT_MANAGER' || (role === 'AREA_MANAGER' && dir.DISTRICT.length)) {
    if (dir.DISTRICT.length) {
      const ph = dir.DISTRICT.map(() => '?').join(',');
      return { sql: `(tickets.district_territory_id IN (${ph}))`, params: [...dir.DISTRICT] };
    }
  }

  if (role === 'AREA_MANAGER') {
    if (dir.AREA.length === 0) return { sql: '1=0', params: [] };
    const ph = dir.AREA.map(() => '?').join(',');
    return { sql: `(tickets.area_territory_id IN (${ph}))`, params: [...dir.AREA] };
  }

  if (role === 'SUPERVISOR') {
    if (dir.SUPERVISOR_TERRITORY.length === 0 && !user.id) {
      return { sql: '1=0', params: [] };
    }
    const clauses = [];
    const params = [];
    if (dir.SUPERVISOR_TERRITORY.length) {
      const ph = dir.SUPERVISOR_TERRITORY.map(() => '?').join(',');
      clauses.push(`tickets.supervisor_territory_id IN (${ph})`);
      params.push(...dir.SUPERVISOR_TERRITORY);
    }
    clauses.push('tickets.assigned_tech_id = ?');
    params.push(user.id);
    return { sql: `(${clauses.join(' OR ')})`, params };
  }

  // TECH / TRAINEE / TRAINER and anything else falls through here
  const clauses = [];
  const params = [];
  if (dir.TECH_TERRITORY.length) {
    const ph = dir.TECH_TERRITORY.map(() => '?').join(',');
    clauses.push(`tickets.tech_territory_id IN (${ph})`);
    params.push(...dir.TECH_TERRITORY);
  }
  clauses.push('tickets.assigned_tech_id = ?');
  params.push(user.id);
  return { sql: `(${clauses.join(' OR ')})`, params };
}

/**
 * Predicate form of buildTicketVisibilityFilter for single-row checks.
 * Safe to call with a ticket row already loaded from the DB.
 */
export function canUserSeeTicket(db, user, ticket) {
  if (!user || !ticket) return false;
  if (user.role === 'DISTRICT_MANAGER') return true;
  if (ticket.assigned_tech_id && ticket.assigned_tech_id === user.id) return true;

  const dir = getUserDirectTerritories(db, user.id);
  if (user.role === 'DISTRICT_MANAGER' && ticket.district_territory_id && dir.DISTRICT.includes(ticket.district_territory_id)) return true;
  if (user.role === 'AREA_MANAGER' && ticket.area_territory_id && dir.AREA.includes(ticket.area_territory_id)) return true;
  if (user.role === 'SUPERVISOR' && ticket.supervisor_territory_id && dir.SUPERVISOR_TERRITORY.includes(ticket.supervisor_territory_id)) return true;
  if (ticket.tech_territory_id && dir.TECH_TERRITORY.includes(ticket.tech_territory_id)) return true;
  return false;
}

/**
 * Return the user IDs of all TECH/TRAINEE/TRAINER users who fall under the
 * given user's hierarchy. For a supervisor, that means techs assigned to
 * TECH_TERRITORYs whose parent chain includes one of the supervisor's
 * SUPERVISOR_TERRITORYs. For an area manager, techs under any supervisor
 * territory in their area. For a district manager, techs under any area in
 * their district. For techs themselves, just their own user id.
 *
 * Returns [] if the user has no downstream techs.
 */
export function getTechIdsUnderUser(db, userId, role) {
  if (!userId) return [];
  if (role === 'TECH' || role === 'TRAINEE' || role === 'TRAINER') {
    return [userId];
  }
  if (role === 'DISTRICT_MANAGER') {
    return db.prepare(`
      SELECT id FROM users
      WHERE role IN ('TECH','TRAINEE','TRAINER') AND is_active = 1
    `).all().map((r) => r.id);
  }

  const dir = getUserDirectTerritories(db, userId);

  // Build the set of supervisor territory IDs whose techs we want.
  let supervisorTerritoryIds = [];

  if (role === 'SUPERVISOR') {
    supervisorTerritoryIds = dir.SUPERVISOR_TERRITORY;
  } else if (role === 'AREA_MANAGER') {
    // Find supervisor territories under the user's areas.
    if (dir.AREA.length === 0) return [];
    const ph = dir.AREA.map(() => '?').join(',');
    supervisorTerritoryIds = db.prepare(`
      SELECT id FROM territories
      WHERE type = 'SUPERVISOR_TERRITORY' AND parent_territory_id IN (${ph})
    `).all(...dir.AREA).map((r) => r.id);
  } else if (role === 'DISTRICT_MANAGER') {
    // Find areas under the user's districts, then supervisor territories under those areas.
    if (dir.DISTRICT.length === 0) return [];
    const dph = dir.DISTRICT.map(() => '?').join(',');
    const areaIds = db.prepare(`
      SELECT id FROM territories
      WHERE type = 'AREA' AND parent_territory_id IN (${dph})
    `).all(...dir.DISTRICT).map((r) => r.id);
    if (areaIds.length === 0) return [];
    const aph = areaIds.map(() => '?').join(',');
    supervisorTerritoryIds = db.prepare(`
      SELECT id FROM territories
      WHERE type = 'SUPERVISOR_TERRITORY' AND parent_territory_id IN (${aph})
    `).all(...areaIds).map((r) => r.id);
  }

  if (supervisorTerritoryIds.length === 0) return [];

  // Find tech territories under those supervisor territories.
  const sph = supervisorTerritoryIds.map(() => '?').join(',');
  const techTerritoryIds = db.prepare(`
    SELECT id FROM territories
    WHERE type = 'TECH_TERRITORY' AND parent_territory_id IN (${sph})
  `).all(...supervisorTerritoryIds).map((r) => r.id);

  if (techTerritoryIds.length === 0) return [];

  // Find active techs assigned to those tech territories.
  const tph = techTerritoryIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT DISTINCT u.id
    FROM users u
    JOIN user_territory_assignments uta ON uta.user_id = u.id
    WHERE uta.territory_id IN (${tph})
      AND (uta.end_date IS NULL OR uta.end_date > ?)
      AND u.role IN ('TECH','TRAINEE','TRAINER')
      AND u.is_active = 1
  `).all(...techTerritoryIds, Date.now()).map((r) => r.id);
}

/**
 * Pick a tech to assign a new ticket to, scoped to a specific tech territory.
 * Uses least-open-ticket load balancing, same policy as the legacy
 * assignmentService. Returns null if no tech is assigned to that territory.
 */
export function pickTechForTerritory(db, techTerritoryId) {
  const techs = db.prepare(`
    SELECT u.id, u.name, u.role
    FROM users u
    JOIN user_territory_assignments uta ON uta.user_id = u.id
    WHERE uta.territory_id = ?
      AND uta.assignment_type = 'TECH_ASSIGNMENT'
      AND (uta.end_date IS NULL OR uta.end_date > ?)
      AND u.is_active = 1
      AND u.role IN ('TECH','TRAINEE','TRAINER')
  `).all(techTerritoryId, Date.now());

  if (techs.length === 0) return null;

  const ids = techs.map((t) => t.id);
  const placeholders = ids.map(() => '?').join(',');
  const loadRows = db.prepare(`
    SELECT assigned_tech_id AS id, COUNT(*) AS cnt
    FROM tickets
    WHERE assigned_tech_id IN (${placeholders})
      AND locator_status NOT IN ('CLOSED', 'UNABLE')
    GROUP BY assigned_tech_id
  `).all(...ids);

  const load = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const r of loadRows) load[r.id] = r.cnt;

  techs.sort((a, b) => (load[a.id] ?? 0) - (load[b.id] ?? 0));
  return techs[0];
}

/**
 * Pick the supervisor who owns a given supervisor territory. Used as a
 * fallback when no tech is assigned to a ticket's tech_territory — the
 * ticket goes to the supervisor so it doesn't sit unassigned.
 * Returns null if no supervisor owns that territory.
 */
export function pickSupervisorForTerritory(db, supervisorTerritoryId) {
  if (!supervisorTerritoryId) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.role
    FROM users u
    JOIN user_territory_assignments uta ON uta.user_id = u.id
    WHERE uta.territory_id = ?
      AND uta.assignment_type IN ('OWNER','MANAGER')
      AND (uta.end_date IS NULL OR uta.end_date > ?)
      AND u.is_active = 1
      AND u.role = 'SUPERVISOR'
    LIMIT 1
  `).get(supervisorTerritoryId, Date.now());
  return row || null;
}

function pointInGeometry(lat, lng, geometry) {
  if (!geometry?.type || !geometry?.coordinates) return false;

  if (geometry.type === 'Polygon') {
    return pointInPolygon([lng, lat], geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInPolygon([lng, lat], polygon));
  }

  return false;
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;

  const [outerRing, ...holes] = polygon;
  if (!pointInRing(point, outerRing)) return false;

  for (const hole of holes) {
    if (pointInRing(point, hole)) return false;
  }

  return true;
}

function pointInRing([x, y], ring) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);

    if (intersects) inside = !inside;
  }

  return inside;
}
