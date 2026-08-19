/**
 * Tests for v1.6 permission system.
 * Run: node tests/permissions.test.js
 */
import {
  ROLES,
  PERMISSIONS,
  hasPermission,
  hasRoleLevel,
  canViewTicket,
  canCloseTicket,
} from '../src/utils/permissions.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

// ── Role enum ──────────────────────────────────────────────
assert(ROLES.TRAINEE === 'TRAINEE', 'TRAINEE role exists');
assert(ROLES.TRAINER === 'TRAINER', 'TRAINER role exists');
assert(ROLES.TECH === 'TECH', 'TECH role exists');
assert(ROLES.SUPERVISOR === 'SUPERVISOR', 'SUPERVISOR role exists');
assert(ROLES.AREA_MANAGER === 'AREA_MANAGER', 'AREA_MANAGER role exists');
assert(ROLES.DISTRICT_MANAGER === 'DISTRICT_MANAGER', 'DISTRICT_MANAGER role exists');
assert(!('MANAGER' in ROLES), 'MANAGER role is removed');

// ── Role hierarchy (tested via hasRoleLevel) ───────────────
assert(hasRoleLevel(ROLES.TRAINEE, ROLES.TRAINEE) === true, 'TRAINEE is level 0 (self)');
assert(hasRoleLevel(ROLES.TRAINER, ROLES.TRAINEE) === true, 'TRAINER > TRAINEE');
assert(hasRoleLevel(ROLES.TECH, ROLES.TRAINER) === true, 'TECH > TRAINER');
assert(hasRoleLevel(ROLES.SUPERVISOR, ROLES.TECH) === true, 'SUPERVISOR > TECH');
assert(hasRoleLevel(ROLES.AREA_MANAGER, ROLES.SUPERVISOR) === true, 'AREA_MANAGER > SUPERVISOR');
assert(hasRoleLevel(ROLES.DISTRICT_MANAGER, ROLES.AREA_MANAGER) === true, 'DISTRICT_MANAGER > AREA_MANAGER (top)');

// ── hasRoleLevel ───────────────────────────────────────────
assert(hasRoleLevel(ROLES.SUPERVISOR, ROLES.TECH) === true, 'SUPERVISOR >= TECH');
assert(hasRoleLevel(ROLES.TECH, ROLES.SUPERVISOR) === false, 'TECH < SUPERVISOR');
assert(hasRoleLevel(ROLES.DISTRICT_MANAGER, ROLES.DISTRICT_MANAGER) === true, 'DISTRICT_MANAGER >= DISTRICT_MANAGER');
assert(hasRoleLevel(ROLES.DISTRICT_MANAGER, ROLES.AREA_MANAGER) === true, 'DISTRICT_MANAGER >= AREA_MANAGER');
assert(hasRoleLevel(ROLES.TRAINEE, ROLES.TRAINEE) === true, 'TRAINEE >= TRAINEE');

// ── PERMISSIONS map ────────────────────────────────────────
assert(Array.isArray(PERMISSIONS['ticket.viewOwn']), 'ticket.viewOwn permission exists');
assert(Array.isArray(PERMISSIONS['ops.viewTeam']), 'ops.viewTeam permission exists');
assert(Array.isArray(PERMISSIONS['ops.viewOrganization']), 'ops.viewOrganization permission exists');

// ── hasPermission ──────────────────────────────────────────
assert(hasPermission(ROLES.TECH, 'ticket.viewOwn') === true, 'TECH has ticket.viewOwn');
assert(hasPermission(ROLES.TRAINEE, 'ticket.viewOwn') === true, 'TRAINEE has ticket.viewOwn');
assert(hasPermission(ROLES.TRAINER, 'ticket.viewOwn') === true, 'TRAINER has ticket.viewOwn');
assert(hasPermission(ROLES.SUPERVISOR, 'ticket.viewOwn') === false, 'SUPERVISOR does not have ticket.viewOwn');
assert(hasPermission(ROLES.SUPERVISOR, 'ticket.viewTeam') === true, 'SUPERVISOR has ticket.viewTeam');
assert(hasPermission(ROLES.AREA_MANAGER, 'ticket.viewTeam') === true, 'AREA_MANAGER has ticket.viewTeam');
assert(hasPermission(ROLES.DISTRICT_MANAGER, 'ticket.viewTeam') === true, 'DISTRICT_MANAGER has ticket.viewTeam');
assert(hasPermission(ROLES.TECH, 'ticket.viewTeam') === false, 'TECH does not have ticket.viewTeam');
assert(hasPermission(ROLES.DISTRICT_MANAGER, 'ops.viewOrganization') === true, 'DISTRICT_MANAGER has ops.viewOrganization');
assert(hasPermission(ROLES.AREA_MANAGER, 'ops.viewOrganization') === false, 'AREA_MANAGER does not have ops.viewOrganization');
assert(hasPermission(ROLES.SUPERVISOR, 'ops.viewTeam') === true, 'SUPERVISOR has ops.viewTeam');
assert(hasPermission(ROLES.TECH, 'ops.viewTeam') === false, 'TECH does not have ops.viewTeam');
assert(hasPermission(ROLES.TECH, 'nonexistent.permission') === false, 'nonexistent permission returns false');

// ── canViewTicket ──────────────────────────────────────────
const techUser = { id: 'tech-1', role: ROLES.TECH };
const supervisorUser = { id: 'sup-1', role: ROLES.SUPERVISOR };
const districtManagerUser = { id: 'dm-1', role: ROLES.DISTRICT_MANAGER };
const ownTicket = { assigned_tech_id: 'tech-1' };
const otherTicket = { assigned_tech_id: 'tech-2' };

assert(canViewTicket(techUser, ownTicket) === true, 'TECH can view own ticket');
assert(canViewTicket(techUser, otherTicket) === false, 'TECH cannot view other ticket');

// ── canCloseTicket ─────────────────────────────────────────
// canCloseTicket for supervisor+ delegates to canEditTicket which needs db for territory scoping.
// Test the role gate directly: TECH/TRAINER can close own, TRAINEE cannot, supervisor+ delegate to canEditTicket.
assert(canCloseTicket(techUser, ownTicket) === true, 'TECH can close own ticket');
assert(canCloseTicket(techUser, otherTicket) === false, 'TECH cannot close other ticket');
assert(canCloseTicket({ id: 'trainee-1', role: ROLES.TRAINEE }, ownTicket) === false, 'TRAINEE cannot close tickets');
assert(canCloseTicket(districtManagerUser, ownTicket) === true, 'DISTRICT_MANAGER can close any ticket (no db needed for DISTRICT_MANAGER)');

// ── Results ────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
