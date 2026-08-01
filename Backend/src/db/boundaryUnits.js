/**
 * Boundary Units - Geographic source of truth for territory definitions.
 * 
 * Imports real city boundary data from texas_cities.geojson (Census TIGER/Line)
 * and stores it for territory building. Backend owns the geography; frontend
 * only visualizes and selects.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Ensure boundary_units and territory_boundary_units tables exist
 */
export function ensureBoundaryUnitSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boundary_units (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL UNIQUE,  -- GEOID from Census data
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'city', -- city, county, zip, etc.
      state_fips TEXT,
      place_fips TEXT,
      geometry_geojson TEXT,  -- Full GeoJSON geometry (Polygon/MultiPolygon)
      centroid_lat REAL,
      centroid_lng REAL,
      bbox_north REAL,
      bbox_south REAL,
      bbox_east REAL,
      bbox_west REAL,
      land_area INTEGER,      -- ALAND from Census
      water_area INTEGER,     -- AWATER from Census
      source_properties TEXT, -- JSON blob of raw Census properties
      active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
    
    CREATE INDEX IF NOT EXISTS idx_boundary_units_type ON boundary_units(type);
    CREATE INDEX IF NOT EXISTS idx_boundary_units_state ON boundary_units(state_fips);
    CREATE INDEX IF NOT EXISTS idx_boundary_units_active ON boundary_units(active);
    CREATE INDEX IF NOT EXISTS idx_boundary_units_coords ON boundary_units(centroid_lat, centroid_lng);
    
    -- Junction table: territories are composed of boundary units
    CREATE TABLE IF NOT EXISTS territory_boundary_units (
      id TEXT PRIMARY KEY,
      territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
      boundary_unit_id TEXT NOT NULL REFERENCES boundary_units(id) ON DELETE CASCADE,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      UNIQUE(territory_id, boundary_unit_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_tbu_territory ON territory_boundary_units(territory_id);
    CREATE INDEX IF NOT EXISTS idx_tbu_unit ON territory_boundary_units(boundary_unit_id);
  `);
}

/**
 * Import Texas cities from GeoJSON file into boundary_units.
 * Idempotent - uses INSERT OR IGNORE on source_id (GEOID).
 */
export function importTexasCitiesFromGeoJSON(db, filePath = null) {
  const geojsonPath = resolveGeojsonPath(filePath);

  console.log(`[Boundary Units] Importing Texas cities from ${geojsonPath}...`);
  
  let geojson;
  try {
    const fileContent = readFileSync(geojsonPath, 'utf-8');
    geojson = JSON.parse(fileContent);
    console.log(`[Boundary Units] Parsed GeoJSON, type: ${geojson.type}, features count: ${geojson.features?.length || 0}`);
  } catch (e) {
    console.error(`[Boundary Units] Failed to read/parse GeoJSON: ${e.message}`);
    return { error: e.message, imported: 0 };
  }
  
  if (!geojson.features || !Array.isArray(geojson.features)) {
    console.error(`[Boundary Units] Invalid GeoJSON: no features array`);
    return { error: 'Invalid GeoJSON: no features array', imported: 0 };
  }
  
  const upsertUnit = db.prepare(`
    INSERT INTO boundary_units (
      id, source_id, name, type, state_fips, place_fips,
      geometry_geojson, centroid_lat, centroid_lng,
      bbox_north, bbox_south, bbox_east, bbox_west,
      land_area, water_area, source_properties
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      id = excluded.id,
      name = excluded.name,
      type = excluded.type,
      state_fips = excluded.state_fips,
      place_fips = excluded.place_fips,
      geometry_geojson = excluded.geometry_geojson,
      centroid_lat = excluded.centroid_lat,
      centroid_lng = excluded.centroid_lng,
      bbox_north = excluded.bbox_north,
      bbox_south = excluded.bbox_south,
      bbox_east = excluded.bbox_east,
      bbox_west = excluded.bbox_west,
      land_area = excluded.land_area,
      water_area = excluded.water_area,
      source_properties = excluded.source_properties,
      active = 1,
      updated_at = (strftime('%s', 'now') * 1000)
  `);
  
  let imported = 0;
  let updated = 0;
  let errors = 0;
  
  let processed = 0;
  let skippedNoGeom = 0;
  let skippedNoProps = 0;
  
  const tx = db.transaction(() => {
    for (const feature of geojson.features) {
      try {
        processed++;
        const props = feature.properties || {};
        const geom = feature.geometry;
        
        if (!geom || !geom.coordinates) {
          skippedNoGeom++;
          continue;
        }
        
        // Extract key fields from Census data
        const geoid = props.GEOID;  // Unique ID like "4869548"
        const name = props.NAME;    // City name like "Splendora"
        const stateFips = props.STATEFP || '48';
        const placeFips = props.PLACEFP;
        
        if (!geoid || !name) {
          skippedNoProps++;
          continue;
        }
        
        // Parse centroid from INTPTLAT/INTPTLON (format: "+30.2283862", "-095.1623542")
        const centroidLat = parseCentroid(props.INTPTLAT);
        const centroidLng = parseCentroid(props.INTPTLON);
        
        // Compute bbox from geometry, or fallback to centroid-based box
        let bbox = computeBBoxFromGeometry(geom);
        if (!bbox && centroidLat && centroidLng) {
          // Create a ~2km box around centroid as fallback
          const offset = 0.01; // roughly 1 degree = 111km, so 0.01 = ~1.1km
          bbox = {
            north: centroidLat + offset,
            south: centroidLat - offset,
            east: centroidLng + offset,
            west: centroidLng - offset,
          };
        }
        
        if (!bbox) {
          errors++;
          console.warn(`[Boundary Units] Could not compute bbox for ${name} (GEOID: ${geoid})`);
          continue;
        }
        
        // Generate internal ID
        const id = `bu-city-${geoid}`;
        
        const existed = db.prepare(`
          SELECT id, geometry_geojson, centroid_lat, centroid_lng,
                 bbox_north, bbox_south, bbox_east, bbox_west,
                 name, place_fips, land_area, water_area
          FROM boundary_units
          WHERE source_id = ?
        `).get(geoid);

        upsertUnit.run(
          id,
          geoid,
          name,
          'city',
          stateFips,
          placeFips,
          JSON.stringify(geom),
          centroidLat,
          centroidLng,
          bbox.north,
          bbox.south,
          bbox.east,
          bbox.west,
          props.ALAND || 0,
          props.AWATER || 0,
          JSON.stringify(props)
        );
        
        if (!existed) {
          imported++;
        } else if (
          existed.name !== name ||
          existed.place_fips !== placeFips ||
          existed.geometry_geojson !== JSON.stringify(geom) ||
          existed.centroid_lat !== centroidLat ||
          existed.centroid_lng !== centroidLng ||
          existed.bbox_north !== bbox.north ||
          existed.bbox_south !== bbox.south ||
          existed.bbox_east !== bbox.east ||
          existed.bbox_west !== bbox.west ||
          existed.land_area !== (props.ALAND || 0) ||
          existed.water_area !== (props.AWATER || 0)
        ) {
          updated++;
        }
      } catch (e) {
        errors++;
        console.warn(`[Boundary Units] Error importing feature: ${e.message}`);
      }
    }
  });
  
  tx();
  
  console.log(`[Boundary Units] Processed ${processed} features: ${imported} inserted, ${updated} updated, ${skippedNoGeom} no geometry, ${skippedNoProps} missing props, ${errors} errors`);
  return { imported, updated, skippedNoGeom, skippedNoProps, errors };
}

function resolveGeojsonPath(explicitPath) {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;

  const candidates = [
    join(process.cwd(), 'texas_cities.geojson'),
    join(process.cwd(), 'Backend', 'texas_cities.geojson'),
    join(process.cwd(), '..', 'Backend', 'texas_cities.geojson'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return explicitPath || candidates[0];
}

/**
 * Parse Census centroid string like "+30.2283862" or "-095.1623542"
 */
function parseCentroid(str) {
  if (!str) return null;
  const clean = str.replace(/^\+/, '');  // Remove leading +
  const num = parseFloat(clean);
  return isNaN(num) ? null : num;
}

/**
 * Compute bounding box from GeoJSON geometry
 */
function computeBBoxFromGeometry(geom) {
  let north = -90, south = 90, east = -180, west = 180;
  
  // Handle Polygon and MultiPolygon
  const coords = geom.type === 'Polygon' 
    ? [geom.coordinates] 
    : geom.type === 'MultiPolygon' 
      ? geom.coordinates 
      : [];
  
  let pointCount = 0;
  for (const polygon of coords) {
    for (const ring of polygon) {
      for (const [lng, lat] of ring) {
        if (lat > north) north = lat;
        if (lat < south) south = lat;
        if (lng > east) east = lng;
        if (lng < west) west = lng;
        pointCount++;
      }
    }
  }
  
  // Validate the computed bbox
  if (pointCount === 0 || north <= south || east <= west) {
    return null; // Invalid geometry
  }
  
  return { north, south, east, west };
}

/**
 * Get all boundary units for a territory
 */
export function getBoundaryUnitsForTerritory(db, territoryId) {
  return db.prepare(`
    SELECT bu.* FROM boundary_units bu
    JOIN territory_boundary_units tbu ON tbu.boundary_unit_id = bu.id
    WHERE tbu.territory_id = ? AND bu.active = 1
    ORDER BY bu.name
  `).all(territoryId);
}

/**
 * Assign boundary units to a territory
 */
export function assignBoundaryUnitsToTerritory(db, territoryId, boundaryUnitIds) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO territory_boundary_units (id, territory_id, boundary_unit_id)
    VALUES (?, ?, ?)
  `);
  
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const unitId of boundaryUnitIds) {
      const id = `tbu-${territoryId}-${unitId}-${now}`;
      insert.run(id, territoryId, unitId);
    }
  });
  
  tx();
}

/**
 * Remove all boundary unit assignments from a territory
 */
export function clearBoundaryUnitsForTerritory(db, territoryId) {
  db.prepare(`DELETE FROM territory_boundary_units WHERE territory_id = ?`).run(territoryId);
}

/**
 * Get boundary units for territory builder (with optional bounding box filter)
 */
export function getBoundaryUnitsForBuilder(db, options = {}) {
  const { 
    type = 'city', 
    state = '48', 
    north, south, east, west,  // bbox filter
    limit = 2500 
  } = options;
  
  let query = `
    SELECT 
      id, source_id, name, type, state_fips,
      centroid_lat, centroid_lng,
      bbox_north, bbox_south, bbox_east, bbox_west,
      land_area, water_area
    FROM boundary_units
    WHERE type = ? AND state_fips = ? AND active = 1
  `;
  const params = [type, state];
  
  if (north !== undefined && south !== undefined && east !== undefined && west !== undefined) {
    // bbox overlap check
    query += ` AND bbox_north >= ? AND bbox_south <= ? AND bbox_east >= ? AND bbox_west <= ?`;
    params.push(south, north, west, east);
  }
  
  query += ` ORDER BY name`;
  if (Number.isFinite(limit) && limit > 0) {
    query += ` LIMIT ?`;
    params.push(limit);
  }
  
  return db.prepare(query).all(...params);
}

/**
 * Check if a point is inside any boundary unit assigned to a territory
 */
export function isPointInTerritory(db, territoryId, lat, lng) {
  // First check bbox of assigned boundary units
  const units = getBoundaryUnitsForTerritory(db, territoryId);
  
  for (const unit of units) {
    // Quick bbox check first
    if (lat < unit.bbox_south || lat > unit.bbox_north || 
        lng < unit.bbox_west || lng > unit.bbox_east) {
      continue;
    }
    
    if (unit.geometry_geojson) {
      try {
        const geom = JSON.parse(unit.geometry_geojson);
        if (pointInGeometry(lat, lng, geom)) return true;
      } catch {
        // Fall through to centroid approximation when stored geometry is invalid.
      }
    }

    if (unit.centroid_lat && unit.centroid_lng) {
      const dist = haversineDistance(lat, lng, unit.centroid_lat, unit.centroid_lng);
      if (dist <= 15) return true;
    }
  }
  
  return false;
}

/**
 * Find which tech territory contains a given point
 */
export function findTechTerritoryForPoint(db, lat, lng) {
  // Get all active TECH_TERRITORY records with their boundary units
  const techTerritories = db.prepare(`
    SELECT t.id, t.name, t.code, t.parent_territory_id,
           GROUP_CONCAT(tbu.boundary_unit_id) as unit_ids
    FROM territories t
    LEFT JOIN territory_boundary_units tbu ON tbu.territory_id = t.id
    WHERE t.type = 'TECH_TERRITORY' AND t.active = 1
    GROUP BY t.id
  `).all();
  
  for (const tech of techTerritories) {
    if (!tech.unit_ids) continue;
    
    const unitIds = tech.unit_ids.split(',');
    
    // Check each boundary unit
    for (const unitId of unitIds) {
      const unit = db.prepare(`
        SELECT geometry_geojson, centroid_lat, centroid_lng, bbox_north, bbox_south, bbox_east, bbox_west
        FROM boundary_units WHERE id = ?
      `).get(unitId);
      
      if (!unit) continue;
      
      // Bbox check first
      if (lat < unit.bbox_south || lat > unit.bbox_north || 
          lng < unit.bbox_west || lng > unit.bbox_east) {
        continue;
      }
      
      if (unit.geometry_geojson) {
        try {
          const geom = JSON.parse(unit.geometry_geojson);
          if (pointInGeometry(lat, lng, geom)) return tech;
        } catch {
          // Fall through to centroid approximation.
        }
      }

      if (unit.centroid_lat && unit.centroid_lng) {
        const dist = haversineDistance(lat, lng, unit.centroid_lat, unit.centroid_lng);
        if (dist <= 15) return tech;
      }
    }
  }
  
  return null;
}

/**
 * Haversine distance in km between two lat/lng points
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;  // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function toRad(deg) {
  return deg * Math.PI / 180;
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
