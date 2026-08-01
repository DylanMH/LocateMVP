/**
 * Permissions utility for role-based access control
 *
 * Role hierarchy (lowest to highest):
 *   TRAINEE < TRAINER < TECH < SUPERVISOR < AREA_MANAGER < MANAGER
 *
 * Permission rules:
 * - Trainees: Can view own assigned tickets, limited editing
 * - Trainer: Can view and manage tickets for their assigned techs, can create/edit notes
 * - Tech: Can view and manage own assigned tickets, full customer marking, clock in/out
 * - Supervisor: Can view/edit tickets in their area, manage clock time, manage field staff
 * - Area Manager: Can act across their area, view all area tickets and staff
 * - Manager: Full system access
 */

import { canUserSeeTicket, buildTicketVisibilityFilter } from '../services/territoryService.js';

export const ROLES = {
  TRAINEE: 'TRAINEE',
  TRAINER: 'TRAINER',
  TECH: 'TECH',
  SUPERVISOR: 'SUPERVISOR',
  AREA_MANAGER: 'AREA_MANAGER',
  DISTRICT_MANAGER: 'DISTRICT_MANAGER',
  MANAGER: 'MANAGER',
};

const ROLE_HIERARCHY = {
  [ROLES.TRAINEE]: 0,
  [ROLES.TRAINER]: 1,
  [ROLES.TECH]: 2,
  [ROLES.SUPERVISOR]: 3,
  [ROLES.AREA_MANAGER]: 4,
  [ROLES.DISTRICT_MANAGER]: 5,
  [ROLES.MANAGER]: 6,
};

/**
 * Check if userRole has at least the required level
 */
export function hasRoleLevel(userRole, minRole) {
  const userLevel = ROLE_HIERARCHY[userRole] ?? -1;
  const minLevel = ROLE_HIERARCHY[minRole] ?? 999;
  return userLevel >= minLevel;
}

/**
 * Check if user can view a specific ticket. Requires the live db instance so
 * we can look up the user's territory assignments. If `db` is omitted this
 * falls back to "assigned to me" only — safe-by-default but less permissive
 * than the real check.
 */
export function canViewTicket(user, ticket, db) {
  if (!user || !ticket) return false;
  if (user.role === ROLES.MANAGER) return true;
  if (db) return canUserSeeTicket(db, user, ticket);
  return ticket.assigned_tech_id === user.id;
}

/**
 * Check if user can edit a specific ticket. Same policy as view for now —
 * territorial scope determines access; role determines what fields are
 * editable (enforced by callers for things like CLOSE).
 */
export function canEditTicket(user, ticket, db) {
  return canViewTicket(user, ticket, db);
}

/**
 * Check if user can close a ticket
 */
export function canCloseTicket(user, ticket) {
  if (!user || !ticket) return false;

  // Only TECH and above can close (not TRAINEE)
  if (user.role === ROLES.TRAINEE) return false;

  // Manager, Area Manager, Supervisor, District Manager can close any ticket in scope
  if ([ROLES.MANAGER, ROLES.AREA_MANAGER, ROLES.DISTRICT_MANAGER, ROLES.SUPERVISOR].includes(user.role)) {
    return canEditTicket(user, ticket, arguments[2]);
  }

  // Tech/Trainer can close their own tickets
  if ([ROLES.TECH, ROLES.TRAINER].includes(user.role)) {
    return ticket.assigned_tech_id === user.id;
  }

  return false;
}

/**
 * Check if user can view timesheet data for target user
 */
export function canViewTimesheet(viewer, targetUserId) {
  if (!viewer) return false;

  // Self access
  if (viewer.id === targetUserId) return true;

  // Manager can view all
  if (viewer.role === ROLES.MANAGER) return true;

  // Area manager can view all in their area
  // (Requires fetching target user's area)

  // Supervisor can view their direct reports
  // (Requires checking supervisor_id chain)

  return false;
}

/**
 * Check if user can clock in/out (must be TECH, TRAINER, or TRAINEE)
 */
export function canClock(user) {
  if (!user) return false;
  return [ROLES.TRAINEE, ROLES.TRAINER, ROLES.TECH].includes(user.role);
}

/**
 * Get list of tech IDs supervised by this user (direct reports)
 * This is a helper that would need to be integrated with actual DB queries
 */
function getSupervisedTechIds(supervisorId) {
  // Placeholder - actual implementation would query the database
  // for users where supervisor_id = supervisorId
  return [];
}

/**
 * Build a parameterized SQL fragment the caller can AND into a WHERE clause.
 * Delegates to territoryService.buildTicketVisibilityFilter.
 * @returns {{ sql: string, params: any[] }}
 */
export function getTicketVisibilityFilter(db, user) {
  return buildTicketVisibilityFilter(db, user);
}

/**
 * @deprecated string-interpolated visibility clause. Retained only because
 * older call sites may still import it. Prefer getTicketVisibilityFilter.
 */
export function getTicketVisibilityClause(user) {
  if (!user) return '1=0';
  if (user.role === ROLES.MANAGER) return '1=1';
  return `assigned_tech_id = '${user.id}'`;
}

/**
 * Search scope by role
 */
export function getSearchScope(user) {
  switch (user.role) {
    case ROLES.MANAGER:
      return { scope: 'ALL', filters: ['ticketNumber', 'address', 'contractor', 'utility', 'dateRange'] };
    case ROLES.AREA_MANAGER:
      return { scope: 'AREA', areaId: user.area_id, filters: ['ticketNumber', 'address', 'dateRange'] };
    case ROLES.SUPERVISOR:
      return { scope: 'AREA', areaId: user.area_id, filters: ['ticketNumber', 'address', 'dateRange'] };
    case ROLES.TRAINER:
      return { scope: 'SUPERVISED', filters: ['ticketNumber'] };
    case ROLES.TECH:
    case ROLES.TRAINEE:
    default:
      return { scope: 'OWN', filters: ['ticketNumber'] };
  }
}
