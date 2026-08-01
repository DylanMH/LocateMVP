/**
 * Conflict Detection Service
 * 
 * Detects and handles conflicts between mobile updates and server state.
 * Uses version numbers and timestamps to determine conflict resolution strategy.
 */

/**
 * Check if a ticket has been modified recently (potential conflict)
 * @param {object} ticket - The current ticket from database
 * @param {number} thresholdMs - Time threshold in milliseconds (default 5 minutes)
 * @returns {boolean}
 */
export function hasRecentServerUpdate(ticket, thresholdMs = 5 * 60 * 1000) {
  if (!ticket || !ticket.updated_at) {
    return false;
  }

  const timeSinceUpdate = Date.now() - ticket.updated_at;
  return timeSinceUpdate < thresholdMs;
}

/**
 * Check if ticket is closed by supervisor (conflict with mobile edits)
 * @param {object} ticket - The current ticket from database
 * @returns {boolean}
 */
export function isClosedBySupervisor(ticket) {
  if (!ticket) {
    return false;
  }

  if (ticket.status !== 'CLOSED' && ticket.locator_status !== 'CLOSED') {
    return false;
  }

  try {
    const payload = JSON.parse(ticket.payload_json || '{}');
    return payload.closedByName && !payload.closedByUserId;
  } catch (e) {
    return false;
  }
}

/**
 * Detect version conflict
 * @param {object} ticket - The current ticket from database
 * @param {number} expectedVersion - Version expected by mobile client
 * @returns {{ hasConflict: boolean, message?: string }}
 */
export function detectVersionConflict(ticket, expectedVersion) {
  if (!ticket) {
    return { hasConflict: false };
  }

  if (expectedVersion === undefined || expectedVersion === null) {
    return { hasConflict: false };
  }

  if (ticket.version !== expectedVersion) {
    return {
      hasConflict: true,
      message: `Version conflict: expected ${expectedVersion}, current ${ticket.version}`,
      currentVersion: ticket.version,
      expectedVersion,
    };
  }

  return { hasConflict: false };
}

/**
 * Determine conflict resolution strategy
 * @param {object} ticket - The current ticket from database
 * @param {object} event - The incoming event from mobile
 * @returns {{ strategy: string, reason: string }}
 */
export function determineConflictStrategy(ticket, event) {
  // Supervisor closed ticket - reject mobile changes
  if (isClosedBySupervisor(ticket)) {
    return {
      strategy: 'REJECT',
      reason: 'Ticket closed by supervisor',
    };
  }

  // Recent server update - warn but allow (mobile is source of truth for status)
  if (hasRecentServerUpdate(ticket)) {
    return {
      strategy: 'ACCEPT_WITH_WARNING',
      reason: 'Recent server update detected, but mobile status takes precedence',
    };
  }

  // No conflicts detected
  return {
    strategy: 'ACCEPT',
    reason: 'No conflicts detected',
  };
}

/**
 * Create a conflict error response
 * @param {string} reason - The reason for the conflict
 * @param {object} details - Additional conflict details
 * @returns {object}
 */
export function createConflictError(reason, details = {}) {
  return {
    error: 'CONFLICT',
    message: reason,
    ...details,
  };
}

/**
 * Log conflict for monitoring
 * @param {string} type - Type of conflict
 * @param {object} details - Conflict details
 */
export function logConflict(type, details) {
  console.warn(`[Conflict] ${type}:`, JSON.stringify(details, null, 2));
}
