import { db } from "./db.js";
import { AREAS } from "../domain/areas.js";

export function seedAreas() {
  const count = db.prepare(`SELECT COUNT(*) as c FROM service_areas`).get() as { c: number };

  // If the area list changed (e.g. new cities added), clear old areas and re-seed.
  const currentIds = new Set<string>(AREAS.map((a) => a.id));
  const existingIds = db.prepare(`SELECT id FROM service_areas`).all() as { id: string }[];
  const needsReseed = existingIds.some((r) => !currentIds.has(r.id)) || existingIds.length !== AREAS.length;

  if (count.c > 0 && !needsReseed) return;

  if (needsReseed) {
    console.log("[seed] Area list changed — clearing old service_areas for re-seed");
    // Delete child rows first to avoid FK constraint failures.
    db.prepare(`DELETE FROM ticket_members_811`).run();
    db.prepare(`DELETE FROM ticket_event_log_811`).run();
    db.prepare(`DELETE FROM tickets_811`).run();
    db.prepare(`DELETE FROM service_areas`).run();
  }

  const ins = db.prepare(`
    INSERT OR REPLACE INTO service_areas (
      id, name, center_lat, center_lng, lat_min, lat_max, lng_min, lng_max, created_at
    ) VALUES (
      @id, @name, @center_lat, @center_lng, @lat_min, @lat_max, @lng_min, @lng_max, @created_at
    )
  `);

  const now = Date.now();
  const tx = db.transaction(() => {
    for (const a of AREAS) {
      ins.run({
        id: a.id,
        name: a.name,
        center_lat: a.centerLat,
        center_lng: a.centerLng,
        lat_min: a.latMin,
        lat_max: a.latMax,
        lng_min: a.lngMin,
        lng_max: a.lngMax,
        created_at: now,
      });
    }
  });

  tx();
  console.log(`[seed] seeded ${AREAS.length} service_areas`);
}
