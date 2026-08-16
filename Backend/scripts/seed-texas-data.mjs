/**
 * Big data seed: creates 3 new Texas areas (North, Central, South),
 * each with 4 supervisor territories, each with 4 tech territories,
 * plus all the users (supervisors + techs) and territory assignments.
 *
 * Also adds 3 more supervisors to the existing East Texas area.
 *
 * Run from the Backend directory:
 *   node scripts/seed-texas-data.mjs
 */
import { db } from "../src/server.js";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const now = Date.now();
const passwordHash = bcrypt.hashSync("password", 10);

// ─── helpers ──────────────────────────────────────────────────────────────

function insertTerritory(id, code, name, type, parent, bbox) {
  db.prepare(`
    INSERT OR IGNORE INTO territories
      (id, code, name, type, parent_territory_id,
       bbox_north, bbox_south, bbox_east, bbox_west, center_lat, center_lng,
       color, active, created_at, updated_at)
    VALUES (@id, @code, @name, @type, @parent,
            @n, @s, @e, @w, @lat, @lng,
            @color, 1, @created, @updated)
  `).run({
    id, code, name, type, parent,
    n: bbox?.n ?? null, s: bbox?.s ?? null, e: bbox?.e ?? null, w: bbox?.w ?? null,
    lat: bbox?.lat ?? null, lng: bbox?.lng ?? null,
    color: bbox?.color ?? null,
    created: now, updated: now,
  });
}

function insertUser(id, name, email, role, supervisorId = null) {
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password_hash, role, is_active, created_at, supervisor_id)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, name, email, passwordHash, role, now, supervisorId);
}

function insertAssignment(userId, territoryId, type) {
  const id = `uta-${userId}-${territoryId}`;
  db.prepare(`
    INSERT OR IGNORE INTO user_territory_assignments
      (id, user_id, territory_id, assignment_type, start_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, territoryId, type, now, now);
}

function bboxFrom(centerLat, centerLng, span = 0.06) {
  return {
    n: centerLat + span / 2,
    s: centerLat - span / 2,
    e: centerLng + span * 1.3 / 2,
    w: centerLng - span * 1.3 / 2,
    lat: centerLat,
    lng: centerLng,
  };
}

// ─── data definition ──────────────────────────────────────────────────────

// Each area: { id, code, name, centerLat, centerLng, color }
// Each supervisor territory: { code, name, centerLat, centerLng, cities: [{id, name, lat, lng}] }

const AREAS = [
  {
    id: "terr-area-ntx", code: "NTX", name: "North Texas",
    centerLat: 32.8, centerLng: -97.1, color: "#2563EB",
    supervisors: [
      {
        code: "NTX-5301", name: "Dallas North",
        centerLat: 33.1, centerLng: -96.7,
        cities: [
          { id: "PLANO", name: "Plano", lat: 33.0198, lng: -96.6989 },
          { id: "FRISCO", name: "Frisco", lat: 33.1507, lng: -96.8236 },
          { id: "MCKINNEY", name: "McKinney", lat: 33.1972, lng: -96.6398 },
          { id: "ALLEN", name: "Allen", lat: 33.1032, lng: -96.6703 },
        ],
      },
      {
        code: "NTX-5302", name: "Dallas South",
        centerLat: 32.64, centerLng: -96.87,
        cities: [
          { id: "OAK_CLIFF", name: "Oak Cliff", lat: 32.7258, lng: -96.8286 },
          { id: "CEDAR_HILL", name: "Cedar Hill", lat: 32.5885, lng: -96.9569 },
          { id: "DUNCANVILLE", name: "Duncanville", lat: 32.6493, lng: -96.9073 },
          { id: "LANCASTER_TX", name: "Lancaster", lat: 32.5921, lng: -96.7700 },
        ],
      },
      {
        code: "NTX-5303", name: "Fort Worth",
        centerLat: 32.65, centerLng: -97.22,
        cities: [
          { id: "FORT_WORTH", name: "Fort Worth", lat: 32.7555, lng: -97.3308 },
          { id: "ARLINGTON_TX", name: "Arlington", lat: 32.7357, lng: -97.1081 },
          { id: "MANSFIELD_TX", name: "Mansfield", lat: 32.5632, lng: -97.1414 },
          { id: "BURLESON", name: "Burleson", lat: 32.5421, lng: -97.3209 },
        ],
      },
      {
        code: "NTX-5304", name: "Mid-Cities",
        centerLat: 32.85, centerLng: -97.06,
        cities: [
          { id: "IRVING", name: "Irving", lat: 32.8140, lng: -96.9490 },
          { id: "GRAPEVINE", name: "Grapevine", lat: 32.9343, lng: -97.0681 },
          { id: "BEDFORD", name: "Bedford", lat: 32.8440, lng: -97.1431 },
          { id: "EULESS", name: "Euless", lat: 32.8371, lng: -97.0820 },
        ],
      },
    ],
  },
  {
    id: "terr-area-ctx", code: "CTX", name: "Central Texas",
    centerLat: 30.3, centerLng: -97.8, color: "#059669",
    supervisors: [
      {
        code: "CTX-5301", name: "Austin North",
        centerLat: 30.55, centerLng: -97.76,
        cities: [
          { id: "ROUND_ROCK", name: "Round Rock", lat: 30.5083, lng: -97.6789 },
          { id: "CEDAR_PARK", name: "Cedar Park", lat: 30.5050, lng: -97.8203 },
          { id: "GEORGETOWN_TX", name: "Georgetown", lat: 30.6339, lng: -97.6772 },
          { id: "LEANDER", name: "Leander", lat: 30.5788, lng: -97.8531 },
        ],
      },
      {
        code: "CTX-5302", name: "Austin Central",
        centerLat: 30.26, centerLng: -97.78,
        cities: [
          { id: "AUSTIN_CENTRAL", name: "Austin Central", lat: 30.2672, lng: -97.7431 },
          { id: "WEST_LAKE_HILLS", name: "West Lake Hills", lat: 30.2840, lng: -97.7964 },
          { id: "SUNSET_VALLEY", name: "Sunset Valley", lat: 30.2318, lng: -97.8064 },
          { id: "ROLLINGWOOD", name: "Rollingwood", lat: 30.2735, lng: -97.7870 },
        ],
      },
      {
        code: "CTX-5303", name: "Austin South",
        centerLat: 29.96, centerLng: -97.83,
        cities: [
          { id: "BUDA", name: "Buda", lat: 30.0846, lng: -97.8397 },
          { id: "KYLE", name: "Kyle", lat: 29.9891, lng: -97.8772 },
          { id: "SAN_MARCOS", name: "San Marcos", lat: 29.8833, lng: -97.9414 },
          { id: "LOCKHART", name: "Lockhart", lat: 29.8852, lng: -97.6700 },
        ],
      },
      {
        code: "CTX-5304", name: "Hill Country",
        centerLat: 30.21, centerLng: -98.03,
        cities: [
          { id: "LAKEWAY", name: "Lakeway", lat: 30.3630, lng: -97.9808 },
          { id: "BEE_CAVE", name: "Bee Cave", lat: 30.3085, lng: -97.9589 },
          { id: "DRIPPING_SPRINGS", name: "Dripping Springs", lat: 30.1902, lng: -98.0867 },
          { id: "WIMBERLEY", name: "Wimberley", lat: 29.9938, lng: -98.0975 },
        ],
      },
    ],
  },
  {
    id: "terr-area-stx", code: "STX", name: "South Texas",
    centerLat: 29.8, centerLng: -95.3, color: "#DC2626",
    supervisors: [
      {
        code: "STX-5301", name: "Houston North",
        centerLat: 30.16, centerLng: -95.49,
        cities: [
          { id: "SPRING_TX", name: "Spring", lat: 30.0790, lng: -95.4170 },
          { id: "THE_WOODLANDS", name: "The Woodlands", lat: 30.1620, lng: -95.4560 },
          { id: "CONROE", name: "Conroe", lat: 30.3119, lng: -95.4561 },
          { id: "TOMBALL", name: "Tomball", lat: 30.0977, lng: -95.6161 },
        ],
      },
      {
        code: "STX-5302", name: "Houston West",
        centerLat: 29.85, centerLng: -95.62,
        cities: [
          { id: "KATY", name: "Katy", lat: 29.7858, lng: -95.8247 },
          { id: "CYPRESS_TX", name: "Cypress", lat: 29.9627, lng: -95.6604 },
          { id: "JERSEY_VILLAGE", name: "Jersey Village", lat: 29.9383, lng: -95.5672 },
          { id: "BELLAIRE", name: "Bellaire", lat: 29.7054, lng: -95.4588 },
        ],
      },
      {
        code: "STX-5303", name: "Houston South",
        centerLat: 29.55, centerLng: -95.18,
        cities: [
          { id: "PEARLAND", name: "Pearland", lat: 29.5635, lng: -95.2861 },
          { id: "FRIENDSWOOD", name: "Friendswood", lat: 29.5294, lng: -95.1980 },
          { id: "LEAGUE_CITY", name: "League City", lat: 29.5075, lng: -95.0949 },
          { id: "CLEAR_LAKE", name: "Clear Lake", lat: 29.5838, lng: -95.0955 },
        ],
      },
      {
        code: "STX-5304", name: "Houston East",
        centerLat: 29.7, centerLng: -95.0,
        cities: [
          { id: "BAYTOWN", name: "Baytown", lat: 29.7355, lng: -94.9774 },
          { id: "PASADENA_TX", name: "Pasadena", lat: 29.6911, lng: -95.2091 },
          { id: "DEER_PARK", name: "Deer Park", lat: 29.7054, lng: -95.5133 },
          { id: "LA_PORTE", name: "La Porte", lat: 29.6656, lng: -95.0447 },
        ],
      },
    ],
  },
];

// Additional supervisors for East Texas (existing area terr-area-etx)
const ETX_NEW_SUPERVISORS = [
  {
    code: "ETX-5302", name: "Kaufman County",
    centerLat: 32.35, centerLng: -96.15,
    cities: [
      { id: "KEMP", name: "Kemp", lat: 32.4513, lng: -96.2254 },
      { id: "MABANK", name: "Mabank", lat: 32.3710, lng: -96.1159 },
      { id: "GUN_BARREL", name: "Gun Barrel City", lat: 32.3276, lng: -96.1026 },
      { id: "SEVEN_POINTS", name: "Seven Points", lat: 32.3283, lng: -96.2064 },
    ],
  },
  {
    code: "ETX-5303", name: "Cedar Creek Lake",
    centerLat: 32.28, centerLng: -96.15,
    cities: [
      { id: "TOOL", name: "Tool", lat: 32.2784, lng: -96.1763 },
      { id: "EUSTACE", name: "Eustace", lat: 32.3129, lng: -96.0108 },
      { id: "ENCHANTED_OAKS", name: "Enchanted Oaks", lat: 32.2648, lng: -96.1102 },
      { id: "SEVEN_POINTS_2", name: "Log Cabin", lat: 32.1646, lng: -96.0950 },
    ],
  },
  {
    code: "ETX-5304", name: "Rockwall County",
    centerLat: 32.85, centerLng: -96.43,
    cities: [
      { id: "HEATH", name: "Heath", lat: 32.8495, lng: -96.4750 },
      { id: "MCLENDON_CHISHOLM", name: "McLendon-Chisholm", lat: 32.8423, lng: -96.3814 },
      { id: "JOSEPHINE", name: "Josephine", lat: 33.0596, lng: -96.3252 },
      { id: "ROCKWALL", name: "Rockwall", lat: 32.9310, lng: -96.4595 },
    ],
  },
];

// Name pools for generating users
const FIRST_NAMES = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "John", "Jennifer", "David", "Susan", "Richard", "Karen", "Joseph", "Nancy", "Charles", "Lisa", "Thomas", "Betty", "Daniel", "Helen", "Matthew", "Sandra", "Anthony", "Donna", "Mark", "Carol", "Donald", "Ruth", "Steven", "Sharon", "Paul", "Michelle", "Andrew", "Laura", "Joshua", "Sarah", "Kenneth", "Kimberly", "Kevin", "Deborah", "Brian", "Dorothy", "George", "Amy", "Edward", "Angela", "Ronald", "Ashley", "Timothy", "Brenda"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts"];

function makeName(used) {
  for (let i = 0; i < 100; i++) {
    const f = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const l = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const name = `${f} ${l}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return `Tech ${Math.floor(Math.random() * 99999)}`;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// ─── main ─────────────────────────────────────────────────────────────────

const usedNames = new Set();
let supervisorCount = 0;
let techCount = 0;
let territoryCount = 0;

const tx = db.transaction(() => {
  const districtId = "terr-district-tx";

  // ── 3 new areas ──
  for (const area of AREAS) {
    insertTerritory(area.id, area.code, area.name, "AREA", districtId, {
      ...bboxFrom(area.centerLat, area.centerLng, 1.5),
      color: area.color,
    });
    territoryCount++;

    // Assign area to King Henry (existing district manager)
    // Actually, assign a new area manager for each area
    const areaMgrName = makeName(usedNames);
    const areaMgrId = `user-${slug(areaMgrName)}`;
    insertUser(areaMgrId, areaMgrName, `${slug(areaMgrName)}@locate720.com`, "AREA_MANAGER");
    insertAssignment(areaMgrId, area.id, "OWNER");

    for (const sup of area.supervisors) {
      const supTerrId = `terr-sup-${slug(sup.code)}`;
      insertTerritory(supTerrId, sup.code, sup.name, "SUPERVISOR_TERRITORY", area.id, {
        ...bboxFrom(sup.centerLat, sup.centerLng, 0.5),
        color: area.color,
      });
      territoryCount++;

      // Create supervisor user
      const supName = makeName(usedNames);
      const supUserId = `user-${slug(supName)}`;
      insertUser(supUserId, supName, `${slug(supName)}@locate720.com`, "SUPERVISOR");
      insertAssignment(supUserId, supTerrId, "OWNER");
      supervisorCount++;

      // Create tech territories under this supervisor
      for (const city of sup.cities) {
        const techTerrId = `terr-tech-${slug(city.id)}`;
        insertTerritory(techTerrId, city.id.toUpperCase().replace(/_/g, "-"), city.name, "TECH_TERRITORY", supTerrId, {
          ...bboxFrom(city.lat, city.lng, 0.08),
          color: area.color,
        });
        territoryCount++;

        // Create 1-2 techs per tech territory
        const numTechs = Math.random() > 0.5 ? 2 : 1;
        for (let t = 0; t < numTechs; t++) {
          const techName = makeName(usedNames);
          const techId = `user-${slug(techName)}-${crypto.randomBytes(2).toString("hex")}`;
          insertUser(techId, techName, `${slug(techName)}@locate720.com`, "TECH", supUserId);
          insertAssignment(techId, techTerrId, "TECH_ASSIGNMENT");
          techCount++;
        }
      }
    }
  }

  // ── 3 new supervisors for East Texas ──
  const etxAreaId = "terr-area-etx";
  for (const sup of ETX_NEW_SUPERVISORS) {
    const supTerrId = `terr-sup-${slug(sup.code)}`;
    insertTerritory(supTerrId, sup.code, sup.name, "SUPERVISOR_TERRITORY", etxAreaId, {
      ...bboxFrom(sup.centerLat, sup.centerLng, 0.5),
      color: "#4B5563",
    });
    territoryCount++;

    // Create supervisor user
    const supName = makeName(usedNames);
    const supUserId = `user-${slug(supName)}`;
    insertUser(supUserId, supName, `${slug(supName)}@locate720.com`, "SUPERVISOR");
    insertAssignment(supUserId, supTerrId, "OWNER");
    supervisorCount++;

    // Create tech territories
    for (const city of sup.cities) {
      // Skip if territory already exists (e.g. HEATH, MCLENDON_CHISHOLM already exist)
      const techTerrId = `terr-tech-${slug(city.id)}`;
      const existing = db.prepare("SELECT 1 FROM territories WHERE id = ?").get(techTerrId);
      if (existing) {
        // Re-parent it to this new supervisor territory
        db.prepare("UPDATE territories SET parent_territory_id = ? WHERE id = ?").run(supTerrId, techTerrId);
        continue;
      }

      insertTerritory(techTerrId, city.id.toUpperCase().replace(/_/g, "-"), city.name, "TECH_TERRITORY", supTerrId, {
        ...bboxFrom(city.lat, city.lng, 0.08),
        color: "#4B5563",
      });
      territoryCount++;

      // Create 1-2 techs
      const numTechs = Math.random() > 0.5 ? 2 : 1;
      for (let t = 0; t < numTechs; t++) {
        const techName = makeName(usedNames);
        const techId = `user-${slug(techName)}-${crypto.randomBytes(2).toString("hex")}`;
        insertUser(techId, techName, `${slug(techName)}@locate720.com`, "TECH", supUserId);
        insertAssignment(techId, techTerrId, "TECH_ASSIGNMENT");
        techCount++;
      }
    }
  }
});

tx();

console.log("=== Texas Data Seed Complete ===");
console.log(`Territories created: ${territoryCount}`);
console.log(`Supervisors created: ${supervisorCount}`);
console.log(`Techs created: ${techCount}`);

// Verify
const totalTerritories = db.prepare("SELECT COUNT(*) as c FROM territories").get();
const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_active = 1").get();
const totalAssignments = db.prepare("SELECT COUNT(*) as c FROM user_territory_assignments").get();
console.log(`Total territories in DB: ${totalTerritories.c}`);
console.log(`Total active users in DB: ${totalUsers.c}`);
console.log(`Total territory assignments: ${totalAssignments.c}`);

process.exit(0);
