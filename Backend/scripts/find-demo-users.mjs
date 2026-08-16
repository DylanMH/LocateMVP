import { initDatabase } from "../src/db/database-sqlite.js";
const db = initDatabase();

// Find King Henry / district manager
const dm = db.prepare("SELECT id, name, email, role FROM users WHERE role = 'DISTRICT_MANAGER'").all();
console.log("District managers:");
console.log(JSON.stringify(dm, null, 2));

// Find a supervisor
const sup = db.prepare("SELECT id, name, email, role FROM users WHERE role = 'SUPERVISOR' LIMIT 3").all();
console.log("\nSample supervisors:");
console.log(JSON.stringify(sup, null, 2));

// Find a tech
const tech = db.prepare("SELECT id, name, email, role FROM users WHERE role = 'TECH' LIMIT 3").all();
console.log("\nSample techs:");
console.log(JSON.stringify(tech, null, 2));

// Find area managers
const am = db.prepare("SELECT id, name, email, role FROM users WHERE role = 'AREA_MANAGER' LIMIT 3").all();
console.log("\nSample area managers:");
console.log(JSON.stringify(am, null, 2));

process.exit(0);
