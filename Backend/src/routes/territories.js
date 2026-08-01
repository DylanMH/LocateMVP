/**
 * Territory management routes.
 *
 * Mounted at /api/ops/territories. Auth is enforced by the parent ops router
 * pattern (authenticateToken middleware is re-used from ops.js via sharing the
 * same JWT secret / helper). For simplicity here we re-declare the middleware
 * locally — the token verification logic is identical.
 *
 * Endpoints:
 *   GET    /                       list all territories (flat) or ?tree=1 (nested)
 *   GET    /:id                    single territory + assignments + derived hierarchy
 *   POST   /                       create a territory
 *   PATCH  /:id                    update a territory
 *   DELETE /:id                    soft-delete (active=0)
 *   POST   /:id/assignments        assign a user { userId, assignmentType }
 *   DELETE /:id/assignments/:userId?type=... remove
 *   GET    /users/:userId/hierarchy  derived { supervisor, areaManager, districtManager }
 *   GET    /users/:userId/assignments  list territory assignments for a user
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server.js';
import { 
  getBoundaryUnitsForBuilder, 
  getBoundaryUnitsForTerritory,
  assignBoundaryUnitsToTerritory,
  clearBoundaryUnitsForTerritory,
  findTechTerritoryForPoint
} from '../db/boundaryUnits.js';

const JWT_SECRET = process.env.JWT_SECRET || 'l720-ops-secret-key';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

const ROLE_ORDER = ['TRAINEE','TRAINER','TECH','SUPERVISOR','AREA_MANAGER','DISTRICT_MANAGER','MANAGER'];
function hasRole(userRole, minRole) {
  return ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole);
}
function requireRole(minRole) {
  return (req, res, next) => {
    if (!hasRole(req.user?.role, minRole)) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher` });
    }
    next();
  };
}

const TYPES = ['DISTRICT','AREA','SUPERVISOR_TERRITORY','TECH_TERRITORY'];
const PARENT_OF = {
  DISTRICT: null,
  AREA: 'DISTRICT',
  SUPERVISOR_TERRITORY: 'AREA',
  TECH_TERRITORY: 'SUPERVISOR_TERRITORY',
};
// When a user of this role is assigned to this territory type, treat it as this assignment_type.
const ROLE_TO_ASSIGNMENT = {
  DISTRICT_MANAGER: 'OWNER',
  AREA_MANAGER: 'OWNER',
  SUPERVISOR: 'OWNER',
  TRAINER: 'TECH_ASSIGNMENT',
  TECH: 'TECH_ASSIGNMENT',
  TRAINEE: 'TECH_ASSIGNMENT',
};
// Preferred territory type for a role
const ROLE_TO_TERRITORY_TYPE = {
  DISTRICT_MANAGER: 'DISTRICT',
  AREA_MANAGER: 'AREA',
  SUPERVISOR: 'SUPERVISOR_TERRITORY',
  TRAINER: 'TECH_TERRITORY',
  TECH: 'TECH_TERRITORY',
  TRAINEE: 'TECH_TERRITORY',
};

function serializeTerritory(t) {
  if (!t) return t;
  let coverage = null;
  if (t.coverage_json) {
    try { coverage = JSON.parse(t.coverage_json); } catch { /* ignore */ }
  }
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    type: t.type,
    parentTerritoryId: t.parent_territory_id,
    bboxNorth: t.bbox_north,
    bboxSouth: t.bbox_south,
    bboxEast: t.bbox_east,
    bboxWest: t.bbox_west,
    centerLat: t.center_lat,
    centerLng: t.center_lng,
    color: t.color,
    active: t.active === 1,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    coverageJson: coverage,
  };
}

function getAssignmentsFor(territoryId) {
  return db.prepare(`
    SELECT uta.id, uta.user_id, uta.assignment_type, uta.start_date, uta.end_date, uta.created_at,
           u.name, u.email, u.role, u.is_active
    FROM user_territory_assignments uta
    JOIN users u ON u.id = uta.user_id
    WHERE uta.territory_id = ?
    ORDER BY uta.created_at ASC
  `).all(territoryId).map((r) => ({
    assignmentId: r.id,
    userId: r.user_id,
    assignmentType: r.assignment_type,
    startDate: r.start_date,
    endDate: r.end_date,
    createdAt: r.created_at,
    name: r.name,
    email: r.email,
    role: r.role,
    isActive: r.is_active === 1,
  }));
}

function walkParents(territoryId) {
  // Returns an array from self up to the root: [self, parent, grandparent, ...]
  const out = [];
  let id = territoryId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const row = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(id);
    if (!row) break;
    out.push(row);
    id = row.parent_territory_id;
  }
  return out;
}

function deriveHierarchyForUser(userId) {
  // For each of a user's territory assignments, climb the tree and collect
  // the OWNER users at each level above. Flattened & deduped.
  const assignments = db.prepare(`
    SELECT territory_id FROM user_territory_assignments
    WHERE user_id = ? AND assignment_type IN ('OWNER','TECH_ASSIGNMENT')
  `).all(userId);

  const result = {
    supervisors: [],
    areaManagers: [],
    districtManagers: [],
  };
  const seenIds = new Set();

  for (const a of assignments) {
    const chain = walkParents(a.territory_id);
    for (const node of chain) {
      const owners = db.prepare(`
        SELECT u.id, u.name, u.email, u.role
        FROM user_territory_assignments uta
        JOIN users u ON u.id = uta.user_id
        WHERE uta.territory_id = ? AND uta.assignment_type = 'OWNER'
          AND u.id != ? AND u.is_active = 1
      `).all(node.id, userId);
      for (const o of owners) {
        const key = `${node.type}:${o.id}`;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        const entry = { id: o.id, name: o.name, email: o.email, role: o.role, territoryId: node.id, territoryCode: node.code, territoryName: node.name };
        if (node.type === 'SUPERVISOR_TERRITORY') result.supervisors.push(entry);
        else if (node.type === 'AREA') result.areaManagers.push(entry);
        else if (node.type === 'DISTRICT') result.districtManagers.push(entry);
      }
    }
  }

  return result;
}

function collectDescendantTerritoryIds(rootId) {
  const allRows = db.prepare(`
    SELECT id, parent_territory_id
    FROM territories
  `).all();

  const childrenByParent = new Map();
  for (const row of allRows) {
    if (!row.parent_territory_id) continue;
    if (!childrenByParent.has(row.parent_territory_id)) {
      childrenByParent.set(row.parent_territory_id, []);
    }
    childrenByParent.get(row.parent_territory_id).push(row.id);
  }

  const collected = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || collected.includes(currentId)) continue;
    collected.push(currentId);
    const childIds = childrenByParent.get(currentId) || [];
    for (const childId of childIds) stack.push(childId);
  }

  return collected;
}

function collectSiblingAssignedBoundaryUnits(territoryId, parentTerritoryId, territoryType) {
  if (!parentTerritoryId) return [];
  return db.prepare(`
    SELECT
      tbu.boundary_unit_id,
      t.id AS territory_id,
      t.name AS territory_name
    FROM territory_boundary_units tbu
    JOIN territories t ON t.id = tbu.territory_id
    WHERE t.parent_territory_id = ?
      AND t.type = ?
      AND t.id != ?
      AND t.active = 1
  `).all(parentTerritoryId, territoryType, territoryId);
}

function updateTerritoryBboxFromUnits(territoryId) {
  const units = getBoundaryUnitsForTerritory(db, territoryId);
  if (units.length === 0) {
    db.prepare(`
      UPDATE territories
      SET bbox_north = NULL, bbox_south = NULL, bbox_east = NULL, bbox_west = NULL,
          center_lat = NULL, center_lng = NULL, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), territoryId);
    return units;
  }

  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const u of units) {
    if (u.bbox_north > north) north = u.bbox_north;
    if (u.bbox_south < south) south = u.bbox_south;
    if (u.bbox_east > east) east = u.bbox_east;
    if (u.bbox_west < west) west = u.bbox_west;
  }
  const centerLat = (north + south) / 2;
  const centerLng = (east + west) / 2;

  db.prepare(`
    UPDATE territories
    SET bbox_north = ?, bbox_south = ?, bbox_east = ?, bbox_west = ?,
        center_lat = ?, center_lng = ?, updated_at = ?
    WHERE id = ?
  `).run(north, south, east, west, centerLat, centerLng, Date.now(), territoryId);

  return units;
}

function pruneDescendantBoundaryUnitsToParentCoverage(parentTerritoryId, allowedUnitIds) {
  const children = db.prepare(`
    SELECT id
    FROM territories
    WHERE parent_territory_id = ? AND active = 1
  `).all(parentTerritoryId);

  for (const child of children) {
    const childUnits = getBoundaryUnitsForTerritory(db, child.id);
    const nextUnitIds = childUnits
      .map((unit) => unit.id)
      .filter((unitId) => allowedUnitIds.has(unitId));

    clearBoundaryUnitsForTerritory(db, child.id);
    if (nextUnitIds.length > 0) {
      assignBoundaryUnitsToTerritory(db, child.id, nextUnitIds);
    }

    updateTerritoryBboxFromUnits(child.id);
    pruneDescendantBoundaryUnitsToParentCoverage(child.id, new Set(nextUnitIds));
  }
}

const router = express.Router();

// ---------- LIST ----------

router.get('/', authenticateToken, (req, res) => {
  const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
  const asTree = req.query.tree === '1' || req.query.tree === 'true';
  const whereActive = includeInactive ? '1=1' : 'active = 1';

  const rows = db.prepare(`SELECT * FROM territories WHERE ${whereActive} ORDER BY type, name`).all();

  // Attach assignment counts + first-user-per-OWNER for convenience
  const ownerRows = db.prepare(`
    SELECT uta.territory_id, u.id, u.name, u.email, u.role, uta.assignment_type
    FROM user_territory_assignments uta
    JOIN users u ON u.id = uta.user_id
    WHERE u.is_active = 1
  `).all();

  const ownersByTerritory = {};
  const assigneeCountByTerritory = {};
  for (const o of ownerRows) {
    assigneeCountByTerritory[o.territory_id] = (assigneeCountByTerritory[o.territory_id] || 0) + 1;
    if (o.assignment_type === 'OWNER' || o.assignment_type === 'MANAGER') {
      if (!ownersByTerritory[o.territory_id]) ownersByTerritory[o.territory_id] = [];
      ownersByTerritory[o.territory_id].push({ id: o.id, name: o.name, email: o.email, role: o.role });
    }
  }

  const serialized = rows.map((r) => ({
    ...serializeTerritory(r),
    owners: ownersByTerritory[r.id] || [],
    assigneeCount: assigneeCountByTerritory[r.id] || 0,
  }));

  if (!asTree) return res.json({ territories: serialized });

  // Build tree
  const byId = Object.fromEntries(serialized.map((t) => [t.id, { ...t, children: [] }]));
  const roots = [];
  for (const t of Object.values(byId)) {
    if (t.parentTerritoryId && byId[t.parentTerritoryId]) {
      byId[t.parentTerritoryId].children.push(t);
    } else {
      roots.push(t);
    }
  }
  // Sort children by type order then name
  const typeOrder = { DISTRICT: 0, AREA: 1, SUPERVISOR_TERRITORY: 2, TECH_TERRITORY: 3 };
  function sortTree(n) {
    n.children.sort((a, b) => (typeOrder[a.type] - typeOrder[b.type]) || a.name.localeCompare(b.name));
    n.children.forEach(sortTree);
  }
  roots.forEach(sortTree);
  res.json({ tree: roots });
});

// ---------- BOUNDARY UNITS (must be before /:id) ----------

// List boundary units (cities) for territory builder
router.get('/boundary-units', authenticateToken, (req, res) => {
  const { type = 'city', north, south, east, west, limit = 2500 } = req.query;

  const units = getBoundaryUnitsForBuilder(db, {
    type,
    state: '48',  // Texas
    north: north ? parseFloat(north) : undefined,
    south: south ? parseFloat(south) : undefined,
    east: east ? parseFloat(east) : undefined,
    west: west ? parseFloat(west) : undefined,
    limit: parseInt(limit)
  });

  res.json({
    units: units.map((u) => ({
      id: u.id,
      sourceId: u.source_id,
      name: u.name,
      type: u.type,
      centroid: { lat: u.centroid_lat, lng: u.centroid_lng },
      bbox: { north: u.bbox_north, south: u.bbox_south, east: u.bbox_east, west: u.bbox_west },
      landArea: u.land_area,
      waterArea: u.water_area,
    })),
    count: units.length,
  });
});

// Get single boundary unit with full geometry
router.get('/boundary-units/:id', authenticateToken, (req, res) => {
  const row = db.prepare(`
    SELECT id, source_id, name, type, state_fips,
           centroid_lat, centroid_lng,
           bbox_north, bbox_south, bbox_east, bbox_west,
           land_area, water_area,
           geometry_geojson, source_properties
    FROM boundary_units
    WHERE id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Boundary unit not found' });

  let geometry = null;
  let properties = null;
  try {
    if (row.geometry_geojson) geometry = JSON.parse(row.geometry_geojson);
    if (row.source_properties) properties = JSON.parse(row.source_properties);
  } catch {
    // ignore parse errors
  }

  res.json({
    unit: {
      id: row.id,
      sourceId: row.source_id,
      name: row.name,
      type: row.type,
      stateFips: row.state_fips,
      centroid: { lat: row.centroid_lat, lng: row.centroid_lng },
      bbox: { north: row.bbox_north, south: row.bbox_south, east: row.bbox_east, west: row.bbox_west },
      landArea: row.land_area,
      waterArea: row.water_area,
      geometry,
      sourceProperties: properties,
    }
  });
});

// ---------- GET ONE ----------

router.get('/:id', authenticateToken, (req, res) => {
  const t = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Territory not found' });

  const children = db.prepare(`SELECT * FROM territories WHERE parent_territory_id = ? AND active = 1 ORDER BY name`)
    .all(t.id).map(serializeTerritory);
  const parentChain = walkParents(t.id).slice(1).map(serializeTerritory); // exclude self

  const assignments = getAssignmentsFor(t.id);

  res.json({
    territory: serializeTerritory(t),
    parentChain,
    children,
    assignments,
  });
});

// ---------- CREATE ----------

router.post('/', authenticateToken, requireRole('AREA_MANAGER'), (req, res) => {
  const { code, name, type, parentTerritoryId, bboxNorth, bboxSouth, bboxEast, bboxWest, centerLat, centerLng, color } = req.body || {};

  if (!code || !name || !type) {
    return res.status(400).json({ error: 'code, name, and type are required' });
  }
  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${TYPES.join(', ')}` });
  }
  // Validate parent
  const requiredParentType = PARENT_OF[type];
  if (requiredParentType === null && parentTerritoryId) {
    return res.status(400).json({ error: `${type} has no parent` });
  }
  if (requiredParentType) {
    if (!parentTerritoryId) return res.status(400).json({ error: `${type} requires parentTerritoryId of type ${requiredParentType}` });
    const parent = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(parentTerritoryId);
    if (!parent) return res.status(400).json({ error: 'Parent territory not found' });
    if (parent.type !== requiredParentType) {
      return res.status(400).json({ error: `Parent must be type ${requiredParentType} (got ${parent.type})` });
    }
  }
  // Unique code
  const dup = db.prepare(`SELECT id FROM territories WHERE code = ?`).get(code);
  if (dup) return res.status(409).json({ error: `Territory code ${code} already exists` });

  const id = `terr-${type.toLowerCase().replace(/_/g, '-')}-${uuidv4().slice(0, 8)}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO territories (id, code, name, type, parent_territory_id,
      bbox_north, bbox_south, bbox_east, bbox_west, center_lat, center_lng,
      color, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, code, name, type, parentTerritoryId || null,
    bboxNorth ?? null, bboxSouth ?? null, bboxEast ?? null, bboxWest ?? null,
    centerLat ?? null, centerLng ?? null, color || null, now, now);

  const row = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(id);
  res.status(201).json({ territory: serializeTerritory(row) });
});

// ---------- UPDATE ----------

router.patch('/:id', authenticateToken, requireRole('AREA_MANAGER'), (req, res) => {
  const t = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Territory not found' });

  const allowed = ['name','parent_territory_id','bbox_north','bbox_south','bbox_east','bbox_west','center_lat','center_lng','color','active'];
  const body = req.body || {};
  const map = {
    name: 'name', parentTerritoryId: 'parent_territory_id',
    bboxNorth: 'bbox_north', bboxSouth: 'bbox_south', bboxEast: 'bbox_east', bboxWest: 'bbox_west',
    centerLat: 'center_lat', centerLng: 'center_lng', color: 'color', active: 'active',
  };

  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(body)) {
    const col = map[k] || (allowed.includes(k) ? k : null);
    if (!col) continue;
    if (col === 'active') {
      sets.push(`${col} = ?`);
      params.push(v ? 1 : 0);
    } else {
      sets.push(`${col} = ?`);
      params.push(v);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(t.id);
  db.prepare(`UPDATE territories SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const row = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(t.id);
  res.json({ territory: serializeTerritory(row) });
});

// ---------- DELETE (soft) ----------

router.delete('/:id', authenticateToken, requireRole('AREA_MANAGER'), (req, res) => {
  const t = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Territory not found' });

  const territoryIds = collectDescendantTerritoryIds(t.id);
  const now = Date.now();
  const placeholders = territoryIds.map(() => '?').join(', ');

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE tickets
      SET district_territory_id = CASE WHEN district_territory_id IN (${placeholders}) THEN NULL ELSE district_territory_id END,
          area_territory_id = CASE WHEN area_territory_id IN (${placeholders}) THEN NULL ELSE area_territory_id END,
          supervisor_territory_id = CASE WHEN supervisor_territory_id IN (${placeholders}) THEN NULL ELSE supervisor_territory_id END,
          tech_territory_id = CASE WHEN tech_territory_id IN (${placeholders}) THEN NULL ELSE tech_territory_id END
      WHERE district_territory_id IN (${placeholders})
         OR area_territory_id IN (${placeholders})
         OR supervisor_territory_id IN (${placeholders})
         OR tech_territory_id IN (${placeholders})
    `).run(
      ...territoryIds,
      ...territoryIds,
      ...territoryIds,
      ...territoryIds,
      ...territoryIds,
      ...territoryIds,
      ...territoryIds,
      ...territoryIds,
    );

    const deleteStmt = db.prepare(`DELETE FROM territories WHERE id = ?`);
    for (const territoryId of [...territoryIds].reverse()) {
      deleteStmt.run(territoryId);
    }
  });

  tx();

  res.json({
    ok: true,
    deletedCount: territoryIds.length,
    territoryIds,
    deletedAt: now,
  });
});

// ---------- ASSIGNMENTS ----------

router.post('/:id/assignments', authenticateToken, requireRole('SUPERVISOR'), (req, res) => {
  const t = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Territory not found' });

  const { userId, assignmentType } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Default assignment type based on user role if not provided
  const finalType = assignmentType || ROLE_TO_ASSIGNMENT[user.role] || 'TECH_ASSIGNMENT';
  if (!['OWNER','MANAGER','TECH_ASSIGNMENT','TRAINER_SUPPORT'].includes(finalType)) {
    return res.status(400).json({ error: 'invalid assignmentType' });
  }

  const id = `uta-${userId}-${t.id}-${finalType.toLowerCase()}`;
  const now = Date.now();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO user_territory_assignments
        (id, user_id, territory_id, assignment_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, t.id, finalType, now);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  res.status(201).json({ ok: true, assignment: { id, userId, territoryId: t.id, assignmentType: finalType, createdAt: now } });
});

router.delete('/:id/assignments/:userId', authenticateToken, requireRole('SUPERVISOR'), (req, res) => {
  const { id, userId } = req.params;
  const type = req.query.type;
  let q = `DELETE FROM user_territory_assignments WHERE territory_id = ? AND user_id = ?`;
  const params = [id, userId];
  if (type) { q += ` AND assignment_type = ?`; params.push(type); }
  const result = db.prepare(q).run(...params);
  res.json({ ok: true, removed: result.changes });
});

// ---------- USER-centric views ----------

router.get('/users/:userId/hierarchy', authenticateToken, (req, res) => {
  const user = db.prepare(`SELECT id, name, role FROM users WHERE id = ?`).get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hierarchy = deriveHierarchyForUser(user.id);
  res.json({ user, hierarchy });
});

router.get('/users/:userId/assignments', authenticateToken, (req, res) => {
  const rows = db.prepare(`
    SELECT uta.id AS assignment_id, uta.assignment_type, uta.territory_id, uta.created_at,
           t.code, t.name, t.type
    FROM user_territory_assignments uta
    JOIN territories t ON t.id = uta.territory_id
    WHERE uta.user_id = ?
    ORDER BY t.type, t.name
  `).all(req.params.userId);
  res.json({
    assignments: rows.map((r) => ({
      assignmentId: r.assignment_id,
      assignmentType: r.assignment_type,
      territoryId: r.territory_id,
      territoryCode: r.code,
      territoryName: r.name,
      territoryType: r.type,
      createdAt: r.created_at,
    })),
  });
});

// ---------- COVERAGE (geo selection) ----------

router.post('/:id/coverage', authenticateToken, requireRole('AREA_MANAGER'), (req, res) => {
  const t = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Territory not found' });

  const { counties, cities, zips } = req.body || {};
  const coverage = { counties: counties || [], cities: cities || [], zips: zips || [] };

  // Auto-compute bbox from selected features
  const bbox = computeBboxFromSelection(db, coverage.counties, coverage.cities);

  const now = Date.now();
  if (bbox) {
    db.prepare(`
      UPDATE territories 
      SET coverage_json = ?, bbox_north = ?, bbox_south = ?, bbox_east = ?, bbox_west = ?, 
          center_lat = ?, center_lng = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(coverage),
      bbox.north, bbox.south, bbox.east, bbox.west,
      bbox.centerLat, bbox.centerLng,
      now, t.id
    );
  } else {
    db.prepare(`UPDATE territories SET coverage_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(coverage), now, t.id);
  }

  const row = db.prepare(`SELECT * FROM territories WHERE id = ?`).get(t.id);
  res.json({ territory: serializeTerritory(row), coverage });
});

// ---------- GEO DATA (counties, cities) ----------

router.get('/geo/counties', authenticateToken, (req, res) => {
  const state = req.query.state || 'TX';
  const rows = db.prepare(`
    SELECT fips, name, state, state_fips, centroid_lat, centroid_lng,
           bbox_north, bbox_south, bbox_east, bbox_west
    FROM geo_counties 
    WHERE state = ? 
    ORDER BY name
  `).all(state);

  res.json({
    counties: rows.map((r) => ({
      fips: r.fips,
      name: r.name,
      state: r.state,
      stateFips: r.state_fips,
      centroid: { lat: r.centroid_lat, lng: r.centroid_lng },
      bbox: { north: r.bbox_north, south: r.bbox_south, east: r.bbox_east, west: r.bbox_west },
    })),
  });
});

router.get('/geo/cities', authenticateToken, (req, res) => {
  const state = req.query.state || 'TX';
  const { north, south, east, west, limit = 2500 } = req.query;

  if (state !== 'TX') {
    return res.json({ cities: [] });
  }

  const rows = getBoundaryUnitsForBuilder(db, {
    type: 'city',
    state: '48',
    north: north ? parseFloat(north) : undefined,
    south: south ? parseFloat(south) : undefined,
    east: east ? parseFloat(east) : undefined,
    west: west ? parseFloat(west) : undefined,
    limit: parseInt(limit, 10),
  });

  res.json({
    cities: rows.map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      name: r.name,
      state: 'TX',
      lat: r.centroid_lat,
      lng: r.centroid_lng,
      population: Math.round((r.land_area || 0) / 1000),
      countyFips: null,
      countyName: null,
      bbox: {
        north: r.bbox_north,
        south: r.bbox_south,
        east: r.bbox_east,
        west: r.bbox_west,
      }
    })),
  });
});

// Get boundary units assigned to a territory
router.get('/:id/boundary-units', authenticateToken, (req, res) => {
  const t = db.prepare(`SELECT id FROM territories WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Territory not found' });
  
  const units = getBoundaryUnitsForTerritory(db, req.params.id);
  
  res.json({
    territoryId: req.params.id,
    units: units.map((u) => ({
      id: u.id,
      sourceId: u.source_id,
      name: u.name,
      type: u.type,
      centroid: { lat: u.centroid_lat, lng: u.centroid_lng },
      bbox: { north: u.bbox_north, south: u.bbox_south, east: u.bbox_east, west: u.bbox_west },
    })),
    count: units.length,
  });
});

// Assign boundary units to a territory (replace mode - clears existing first)
router.post('/:id/boundary-units', authenticateToken, requireRole('AREA_MANAGER'), (req, res) => {
  const t = db.prepare(`SELECT id, type, parent_territory_id FROM territories WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Territory not found' });
  
  const { boundaryUnitIds, mode = 'replace' } = req.body || {};
  if (!Array.isArray(boundaryUnitIds)) {
    return res.status(400).json({ error: 'boundaryUnitIds must be an array' });
  }
  
  // Validate all unit IDs exist
  let validIds = [];
  let invalidIds = [];
  if (boundaryUnitIds.length > 0) {
    const placeholders = boundaryUnitIds.map(() => '?').join(',');
    const existingUnits = db.prepare(`
      SELECT id FROM boundary_units WHERE id IN (${placeholders})
    `).all(...boundaryUnitIds);
    validIds = existingUnits.map((u) => u.id);
    invalidIds = boundaryUnitIds.filter((id) => !validIds.includes(id));
  }
  
  if (invalidIds.length > 0) {
    return res.status(400).json({ error: `Invalid boundary unit IDs: ${invalidIds.join(', ')}` });
  }

  if (validIds.length > 0 && t.type !== 'AREA' && t.parent_territory_id) {
    const parentUnitIds = new Set(
      getBoundaryUnitsForTerritory(db, t.parent_territory_id).map((unit) => unit.id)
    );
    const outOfScopeIds = validIds.filter((id) => !parentUnitIds.has(id));
    if (outOfScopeIds.length > 0) {
      return res.status(400).json({
        error: `Boundary units must be selected from the parent territory coverage: ${outOfScopeIds.join(', ')}`,
      });
    }
  }

  if (validIds.length > 0 && t.parent_territory_id) {
    const siblingAssignments = collectSiblingAssignedBoundaryUnits(
      t.id,
      t.parent_territory_id,
      t.type,
    );
    const siblingUnitMap = new Map(
      siblingAssignments.map((row) => [row.boundary_unit_id, row.territory_name]),
    );
    const overlappingIds = validIds.filter((id) => siblingUnitMap.has(id));
    if (overlappingIds.length > 0) {
      const overlaps = overlappingIds.map((id) => `${id} (${siblingUnitMap.get(id)})`);
      return res.status(409).json({
        error: `Boundary units are already assigned to sibling territories: ${overlaps.join(', ')}`,
      });
    }
  }
  
  // Clear existing if replace mode
  if (mode === 'replace') {
    clearBoundaryUnitsForTerritory(db, req.params.id);
  }
  
  // Assign new units
  if (validIds.length > 0) {
    assignBoundaryUnitsToTerritory(db, req.params.id, validIds);
  }
  
  // Return updated list
  const units = updateTerritoryBboxFromUnits(req.params.id);
  pruneDescendantBoundaryUnitsToParentCoverage(req.params.id, new Set(units.map((unit) => unit.id)));
  
  res.json({
    territoryId: req.params.id,
    units: units.map((u) => ({
      id: u.id,
      sourceId: u.source_id,
      name: u.name,
      type: u.type,
      centroid: { lat: u.centroid_lat, lng: u.centroid_lng },
    })),
    count: units.length,
    assigned: validIds.length,
    rejected: invalidIds.length,
  });
});

// Clear boundary units from a territory
router.delete('/:id/boundary-units', authenticateToken, requireRole('AREA_MANAGER'), (req, res) => {
  const t = db.prepare(`SELECT id FROM territories WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Territory not found' });
  
  clearBoundaryUnitsForTerritory(db, req.params.id);
  res.json({ ok: true, territoryId: req.params.id });
});

// ---------- POINT LOOKUP (for ticket ingestion) ----------

// Find which tech territory contains a given point
router.post('/lookup-point', authenticateToken, (req, res) => {
  const { lat, lng } = req.body || {};
  
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng must be numbers' });
  }
  
  const tech = findTechTerritoryForPoint(db, lat, lng);
  
  if (!tech) {
    return res.json({ found: false, lat, lng });
  }
  
  // Get parent chain
  const chain = walkUpChain(db, tech.id);
  
  res.json({
    found: true,
    lat,
    lng,
    techTerritory: { id: tech.id, name: tech.name, code: tech.code },
    chain: {
      districtTerritoryId: chain.district_territory_id,
      areaTerritoryId: chain.area_territory_id,
      supervisorTerritoryId: chain.supervisor_territory_id,
      techTerritoryId: tech.id,
    }
  });
});

function walkUpChain(db, techTerritoryId) {
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

// Helper exports for ops.js to reuse (e.g. on user-create with territoryAssignments).
export { ROLE_TO_ASSIGNMENT, ROLE_TO_TERRITORY_TYPE };

export default router;
