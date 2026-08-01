/**
 * Status Machine Validation
 * 
 * Defines valid ticket status transitions and validation rules.
 * This is the server-side source of truth for status changes.
 */

export const TicketStatus = {
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  CLOSED: 'CLOSED',
};

export const LocatorStatus = {
  ASSIGNED: 'ASSIGNED',
  ENROUTE: 'ENROUTE',
  ONSITE: 'ONSITE',
  PAUSED: 'PAUSED',
  CLOSED: 'CLOSED',
  UNABLE: 'UNABLE',
};

const VALID_TRANSITIONS = {
  [LocatorStatus.ASSIGNED]: [LocatorStatus.ENROUTE, LocatorStatus.UNABLE],
  [LocatorStatus.ENROUTE]: [LocatorStatus.ONSITE, LocatorStatus.ASSIGNED, LocatorStatus.UNABLE],
  [LocatorStatus.ONSITE]: [LocatorStatus.PAUSED, LocatorStatus.CLOSED, LocatorStatus.UNABLE],
  [LocatorStatus.PAUSED]: [LocatorStatus.ONSITE],
  [LocatorStatus.CLOSED]: [],
  [LocatorStatus.UNABLE]: [],
};

/**
 * Validate if a status transition is allowed
 * @param {string} currentStatus - Current locator status
 * @param {string} nextStatus - Desired next status
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateStatusTransition(currentStatus, nextStatus) {
  if (!currentStatus) {
    return { valid: false, error: 'Current status is required' };
  }

  if (!nextStatus) {
    return { valid: false, error: 'Next status is required' };
  }

  if (!Object.values(LocatorStatus).includes(currentStatus)) {
    return { valid: false, error: `Invalid current status: ${currentStatus}` };
  }

  if (!Object.values(LocatorStatus).includes(nextStatus)) {
    return { valid: false, error: `Invalid next status: ${nextStatus}` };
  }

  if (currentStatus === nextStatus) {
    return { valid: true };
  }

  const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
  
  if (!allowedTransitions.includes(nextStatus)) {
    return {
      valid: false,
      error: `Invalid transition from ${currentStatus} to ${nextStatus}. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
    };
  }

  return { valid: true };
}

/**
 * Validate required payload fields for a given status
 * @param {string} status - The status to validate
 * @param {object} payload - The ticket payload
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateStatusPayload(status, payload) {
  const requiredFields = {
    [LocatorStatus.ENROUTE]: ['enrouteStartedAt'],
    [LocatorStatus.ONSITE]: ['onsiteStartedAt'],
    [LocatorStatus.CLOSED]: ['onsiteStartedAt', 'closedAt', 'customerMarkings'],
    [LocatorStatus.UNABLE]: ['closedAt'],
  };

  const required = requiredFields[status];
  if (!required) {
    return { valid: true };
  }

  const missing = required.filter(field => !payload[field]);
  
  if (missing.length > 0) {
    return {
      valid: false,
      error: `Missing required fields for status ${status}: ${missing.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Get all valid next statuses for a given current status
 * @param {string} currentStatus - Current locator status
 * @returns {string[]}
 */
export function getValidNextStatuses(currentStatus) {
  return VALID_TRANSITIONS[currentStatus] || [];
}
