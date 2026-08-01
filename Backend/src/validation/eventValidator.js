/**
 * Event Validation
 * 
 * Validates incoming sync events from mobile app.
 * Ensures events have required fields and valid data.
 */

import { validateStatusTransition, validateStatusPayload } from './statusMachine.js';

const validMarkingStatuses = new Set(['', 'MARKED', 'NOT_MARKED', 'NOT_YET_MARKED']);
const validMarkingResults = new Set([
  '',
  'PAINT_AND_FLAG',
  'PAINT_ONLY',
  'EXCAVATION_SITE_CLEAR',
  'UNLOCATABLE',
  'NO_ACCESS',
  'MEETING_WITH_CONTRACTOR',
]);

function isWholeNumberString(value) {
  return typeof value === 'string' && /^\d+$/.test(value);
}

export function validateCustomerMarkingObject(customerMarking) {
  if (!customerMarking || typeof customerMarking !== 'object' || Array.isArray(customerMarking)) {
    return { valid: false, error: 'customerMarking object is required' };
  }

  for (const [customerId, marking] of Object.entries(customerMarking)) {
    if (!customerId) {
      return { valid: false, error: 'customerMarking contains an empty customerId key' };
    }

    if (!marking || typeof marking !== 'object' || Array.isArray(marking)) {
      return { valid: false, error: `customerMarking for ${customerId} must be an object` };
    }

    if (!validMarkingStatuses.has(marking.status ?? '')) {
      return { valid: false, error: `Invalid marking status for ${customerId}` };
    }

    if (!validMarkingResults.has(marking.result ?? '')) {
      return { valid: false, error: `Invalid marking result for ${customerId}` };
    }

    if (marking.minutes !== undefined && marking.minutes !== '' && !isWholeNumberString(marking.minutes)) {
      return { valid: false, error: `Minutes for ${customerId} must be a whole-number string` };
    }

    if (marking.footage !== undefined && marking.footage !== '' && !isWholeNumberString(marking.footage)) {
      return { valid: false, error: `Footage for ${customerId} must be a whole-number string` };
    }

    if (marking.completed !== undefined && typeof marking.completed !== 'boolean') {
      return { valid: false, error: `Completed flag for ${customerId} must be boolean` };
    }

    if (marking.status === 'MARKED' && marking.completed && !marking.footage) {
      return { valid: false, error: `Completed MARKED utility ${customerId} requires footage` };
    }

    if (marking.completed && (!marking.status || !marking.result || marking.minutes === undefined || marking.minutes === '')) {
      return { valid: false, error: `Completed utility ${customerId} must include status, result, and minutes` };
    }
  }

  return { valid: true };
}

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {string} [error]
 */

/**
 * Validate a TICKET_STATUS_SET event
 * @param {object} event - The event to validate
 * @param {object} currentTicket - The current ticket from database
 * @returns {ValidationResult}
 */
export function validateTicketStatusSetEvent(event, currentTicket) {
  const { payload } = event;

  if (!payload) {
    return { valid: false, error: 'Event payload is required' };
  }

  const { ticketId, nextStatus, payloadUpdates } = payload;

  if (!ticketId) {
    return { valid: false, error: 'ticketId is required' };
  }

  if (!nextStatus) {
    return { valid: false, error: 'nextStatus is required' };
  }

  if (!currentTicket) {
    return { valid: false, error: `Ticket ${ticketId} not found` };
  }

  const currentStatus = currentTicket.locator_status;
  const transitionResult = validateStatusTransition(currentStatus, nextStatus);
  
  if (!transitionResult.valid) {
    return transitionResult;
  }

  const existingPayload = JSON.parse(currentTicket.payload_json || '{}');
  const mergedPayload = { ...existingPayload, ...(payloadUpdates || {}) };

  const customerMarking = mergedPayload.customerMarking || mergedPayload.customerMarkings;
  if (customerMarking) {
    const markingValidation = validateCustomerMarkingObject(customerMarking);
    if (!markingValidation.valid) {
      return markingValidation;
    }
  }
  
  const payloadResult = validateStatusPayload(nextStatus, mergedPayload);
  if (!payloadResult.valid) {
    return payloadResult;
  }

  return { valid: true };
}

/**
 * Validate a TICKET_CLOSED event
 * @param {object} event - The event to validate
 * @param {object} currentTicket - The current ticket from database
 * @returns {ValidationResult}
 */
export function validateTicketClosedEvent(event, currentTicket) {
  const { payload } = event;

  if (!payload) {
    return { valid: false, error: 'Event payload is required' };
  }

  const { ticketId, closedByUserId, customerMarkings } = payload;

  if (!ticketId) {
    return { valid: false, error: 'ticketId is required' };
  }

  if (!closedByUserId) {
    return { valid: false, error: 'closedByUserId is required' };
  }

  if (!customerMarkings || !Array.isArray(customerMarkings)) {
    return { valid: false, error: 'customerMarkings array is required' };
  }

  if (!currentTicket) {
    return { valid: false, error: `Ticket ${ticketId} not found` };
  }

  if (currentTicket.locator_status === 'CLOSED') {
    return { valid: false, error: 'Ticket is already closed' };
  }

  for (const marking of customerMarkings) {
    if (!marking.customerId) {
      return { valid: false, error: 'Each customer marking must have customerId' };
    }
    if (!marking.responseCode) {
      return { valid: false, error: 'Each customer marking must have responseCode' };
    }
  }

  return { valid: true };
}

/**
 * Validate a TICKET_CUSTOMER_MARKING_SET event
 * @param {object} event - The event to validate
 * @param {object} currentTicket - The current ticket from database
 * @returns {ValidationResult}
 */
export function validateTicketCustomerMarkingSetEvent(event, currentTicket) {
  const { payload } = event;

  if (!payload) {
    return { valid: false, error: 'Event payload is required' };
  }

  const { ticketId, payloadUpdates } = payload;

  if (!ticketId) {
    return { valid: false, error: 'ticketId is required' };
  }

  if (!currentTicket) {
    return { valid: false, error: `Ticket ${ticketId} not found` };
  }

  const customerMarking =
    payloadUpdates?.customerMarking || payloadUpdates?.customerMarkings;

  return validateCustomerMarkingObject(customerMarking);
}

/**
 * Validate common event fields
 * @param {object} event - The event to validate
 * @returns {ValidationResult}
 */
export function validateEventStructure(event) {
  if (!event) {
    return { valid: false, error: 'Event is required' };
  }

  const { type, requestId, deviceId, seq, occurredAt, payload } = event;

  if (!type) {
    return { valid: false, error: 'Event type is required' };
  }

  if (!requestId) {
    return { valid: false, error: 'requestId is required' };
  }

  if (!deviceId) {
    return { valid: false, error: 'deviceId is required' };
  }

  if (typeof seq !== 'number') {
    return { valid: false, error: 'seq must be a number' };
  }

  if (!occurredAt || typeof occurredAt !== 'number') {
    return { valid: false, error: 'occurredAt must be a timestamp' };
  }

  if (!payload) {
    return { valid: false, error: 'payload is required' };
  }

  return { valid: true };
}
