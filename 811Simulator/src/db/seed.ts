import { db } from "./db.js";
import { AREAS } from "../domain/areas.js";

export function seedAreas() {
  const count = db.prepare(`SELECT COUNT(*) as c FROM service_areas`).get() as { c: number };
  if (count.c > 0) return;

  const ins = db.prepare(`
    INSERT INTO service_areas (
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
  console.log("[seed] seeded service_areas");
}
