/**
 * Territory schema + seed + backfill.
 *
 * Territory model:
 *   DISTRICT -> AREA -> SUPERVISOR_TERRITORY -> TECH_TERRITORY
 *
 * A ticket is routed to a TECH_TERRITORY by geospatial resolution (lat/lng
 * inside a tech territory bbox). The supervisor/area/district FKs are
 * filled by walking the parent chain. See docs user spec.
 *
 * This module is intentionally idempotent: it can be called on every server
 * boot. It will not duplicate rows or overwrite user customizations.
 */

/**
 * Create the territory tables + add the 4 territory FK columns to tickets.
 * Called once at startup from database-sqlite.js.
 */
export function ensureTerritorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS territories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('DISTRICT','AREA','SUPERVISOR_TERRITORY','TECH_TERRITORY')),
      parent_territory_id TEXT REFERENCES territories(id),
      bbox_north REAL,
      bbox_south REAL,
      bbox_east REAL,
      bbox_west REAL,
      center_lat REAL,
      center_lng REAL,
      polygon_geojson TEXT,
      color TEXT,
      active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_territories_type ON territories(type);
    CREATE INDEX IF NOT EXISTS idx_territories_parent ON territories(parent_territory_id);
    CREATE INDEX IF NOT EXISTS idx_territories_code ON territories(code);

    CREATE TABLE IF NOT EXISTS user_territory_assignments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      territory_id TEXT NOT NULL,
      assignment_type TEXT NOT NULL CHECK (assignment_type IN ('OWNER','MANAGER','TECH_ASSIGNMENT','TRAINER_SUPPORT')),
      start_date INTEGER,
      end_date INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (territory_id) REFERENCES territories(id) ON DELETE CASCADE,
      UNIQUE (user_id, territory_id, assignment_type)
    );

    CREATE INDEX IF NOT EXISTS idx_uta_user ON user_territory_assignments(user_id);
    CREATE INDEX IF NOT EXISTS idx_uta_territory ON user_territory_assignments(territory_id);
    CREATE INDEX IF NOT EXISTS idx_uta_type ON user_territory_assignments(assignment_type);
  `);

  // Add territory FKs to tickets (additive, non-breaking)
  const addCol = (col) => {
    const cols = db.prepare(`PRAGMA table_info(tickets)`).all();
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE tickets ADD COLUMN ${col} TEXT`);
    }
  };
  addCol('district_territory_id');
  addCol('area_territory_id');
  addCol('supervisor_territory_id');
  addCol('tech_territory_id');

  // Add coverage_json to territories (additive — used by territoryService
  // and the coverage route for legacy city/county/zip coverage definitions).
  const territoryCols = db.prepare(`PRAGMA table_info(territories)`).all();
  if (!territoryCols.some((c) => c.name === 'coverage_json')) {
    db.exec(`ALTER TABLE territories ADD COLUMN coverage_json TEXT`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tickets_district_territory ON tickets(district_territory_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_area_territory ON tickets(area_territory_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_supervisor_territory ON tickets(supervisor_territory_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_tech_territory ON tickets(tech_territory_id);
  `);
}

/**
 * Seed the initial territory tree. Uses existing `areas` bboxes (if present)
 * so no geospatial data is lost.
 *
 *   TX (DISTRICT)
 *   └── ETX (AREA) "East Texas"
 *       ├── ETX5301 (SUPERVISOR)
 *       │   └── Rockwall, Fate, Lavon, Greenville, Royse City, Heath, Wylie, Josephine
 *       └── ETX5302 (SUPERVISOR)
 *           └── Dallas, Plano, Garland, Mesquite
 *
 * Idempotent: uses INSERT OR IGNORE on (code).
 */
export function seedTerritoryTree(db) {
  const now = Date.now();
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO territories
      (id, code, name, type, parent_territory_id,
       bbox_north, bbox_south, bbox_east, bbox_west, center_lat, center_lng,
       color, active, created_at, updated_at)
    VALUES (@id, @code, @name, @type, @parent,
            @n, @s, @e, @w, @lat, @lng,
            @color, 1, @created, @updated)
  `);

  const tx = db.transaction(() => {
    insertStmt.run({
      id: 'terr-district-tx', code: 'TX', name: 'Texas',
      type: 'DISTRICT', parent: null,
      n: null, s: null, e: null, w: null, lat: null, lng: null,
      color: '#1F2937', created: now, updated: now,
    });

    insertStmt.run({
      id: 'terr-area-etx', code: 'ETX', name: 'East Texas',
      type: 'AREA', parent: 'terr-district-tx',
      n: null, s: null, e: null, w: null, lat: null, lng: null,
      color: '#4B5563', created: now, updated: now,
    });
  });

  tx();
}

/**
 * Backfill: for every ticket missing tech_territory_id, resolve by lat/lng
 * and populate the full 4-level chain.
 */
export function backfillTicketTerritories(db) {
  const unresolved = db.prepare(`
    SELECT id, lat, lng FROM tickets
    WHERE tech_territory_id IS NULL AND lat IS NOT NULL AND lng IS NOT NULL
  `).all();

  if (unresolved.length === 0) return { updated: 0, unresolved: 0 };

  // Cache the territory tree once
  const techTerritories = db.prepare(`
    SELECT id, parent_territory_id, bbox_north, bbox_south, bbox_east, bbox_west
    FROM territories
    WHERE type = 'TECH_TERRITORY' AND active = 1
      AND bbox_north IS NOT NULL AND bbox_south IS NOT NULL
      AND bbox_east IS NOT NULL AND bbox_west IS NOT NULL
  `).all();

  const parentMap = new Map(
    db.prepare(`SELECT id, type, parent_territory_id FROM territories`).all()
      .map((r) => [r.id, r]),
  );

  function chainFor(techTerritoryId) {
    const chain = { tech: techTerritoryId, supervisor: null, area: null, district: null };
    let cur = parentMap.get(techTerritoryId);
    while (cur) {
      if (cur.type === 'SUPERVISOR_TERRITORY') chain.supervisor = cur.id;
      else if (cur.type === 'AREA') chain.area = cur.id;
      else if (cur.type === 'DISTRICT') chain.district = cur.id;
      cur = cur.parent_territory_id ? parentMap.get(cur.parent_territory_id) : null;
    }
    return chain;
  }

  const update = db.prepare(`
    UPDATE tickets
    SET tech_territory_id = ?, supervisor_territory_id = ?,
        area_territory_id = ?, district_territory_id = ?
    WHERE id = ?
  `);

  let updated = 0;
  let unresolvedCount = 0;

  const tx = db.transaction(() => {
    for (const t of unresolved) {
      const match = techTerritories.find((tt) =>
        t.lat >= tt.bbox_south && t.lat <= tt.bbox_north &&
        t.lng >= tt.bbox_west  && t.lng <= tt.bbox_east,
      );
      if (!match) {
        unresolvedCount++;
        continue;
      }
      const chain = chainFor(match.id);
      update.run(chain.tech, chain.supervisor, chain.area, chain.district, t.id);
      updated++;
    }
  });
  tx();

  return { updated, unresolved: unresolvedCount };
}

/**
 * One-shot migration of legacy user_areas rows into
 * user_territory_assignments as TECH_ASSIGNMENT. Idempotent via UNIQUE index.
 */
export function backfillUserTerritoryAssignments(db) {
  let migrated = 0;
  try {
    const rows = db.prepare(`SELECT user_id, area_id, assigned_at FROM user_areas`).all();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO user_territory_assignments
        (id, user_id, territory_id, assignment_type, created_at)
      VALUES (?, ?, ?, 'TECH_ASSIGNMENT', ?)
    `);
    const tx = db.transaction(() => {
      for (const r of rows) {
        const territoryId = `terr-tech-${String(r.area_id).toLowerCase()}`;
        const exists = db.prepare(`SELECT 1 FROM territories WHERE id = ?`).get(territoryId);
        if (!exists) continue;
        const id = `uta-${r.user_id}-${territoryId}`;
        const res = insert.run(id, r.user_id, territoryId, r.assigned_at || Date.now());
        if (res.changes > 0) migrated++;
      }
    });
    tx();
  } catch {
    // user_areas table may not exist
  }

  // Also migrate legacy users.area_id -> TECH_ASSIGNMENT so existing techs keep working.
  try {
    const techs = db.prepare(`
      SELECT id AS user_id, area_id FROM users
      WHERE role = 'TECH' AND area_id IS NOT NULL
    `).all();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO user_territory_assignments
        (id, user_id, territory_id, assignment_type, created_at)
      VALUES (?, ?, ?, 'TECH_ASSIGNMENT', ?)
    `);
    const tx = db.transaction(() => {
      for (const r of techs) {
        const territoryId = `terr-tech-${String(r.area_id).toLowerCase()}`;
        const exists = db.prepare(`SELECT 1 FROM territories WHERE id = ?`).get(territoryId);
        if (!exists) continue;
        const id = `uta-${r.user_id}-${territoryId}`;
        const res = insert.run(id, r.user_id, territoryId, Date.now());
        if (res.changes > 0) migrated++;
      }
    });
    tx();
  } catch {
    // ignore
  }

  return { migrated };
}
