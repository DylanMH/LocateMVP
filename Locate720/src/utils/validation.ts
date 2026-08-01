/**
 * Input validation and sanitization utilities
 * Critical for security and data integrity at enterprise scale
 */

/**
 * Sanitize ticket ID - only allow alphanumeric, dash, underscore
 */
export function sanitizeTicketId(id: string): string {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid ticket ID: must be a non-empty string');
  }
  
  const sanitized = id.replace(/[^a-zA-Z0-9-_]/g, '');
  
  if (sanitized.length === 0) {
    throw new Error('Invalid ticket ID: contains no valid characters');
  }
  
  if (sanitized.length > 100) {
    throw new Error('Invalid ticket ID: too long (max 100 characters)');
  }
  
  return sanitized;
}

/**
 * Sanitize user ID
 */
export function sanitizeUserId(id: string): string {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid user ID: must be a non-empty string');
  }
  
  const sanitized = id.replace(/[^a-zA-Z0-9-_]/g, '');
  
  if (sanitized.length === 0) {
    throw new Error('Invalid user ID: contains no valid characters');
  }
  
  return sanitized;
}

/**
 * Sanitize session ID
 */
export function sanitizeSessionId(id: string): string {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid session ID: must be a non-empty string');
  }
  
  // Session IDs are UUIDs or WatermelonDB IDs
  const sanitized = id.replace(/[^a-zA-Z0-9-]/g, '');
  
  if (sanitized.length === 0) {
    throw new Error('Invalid session ID: contains no valid characters');
  }
  
  return sanitized;
}

/**
 * Validate clock event type
 */
export function validateClockEventType(
  eventType: string
): eventType is 'CLOCK_IN' | 'CLOCK_OUT' | 'LUNCH_START' | 'LUNCH_END' | 'PERSONAL_START' | 'PERSONAL_END' {
  const validTypes = ['CLOCK_IN', 'CLOCK_OUT', 'LUNCH_START', 'LUNCH_END', 'PERSONAL_START', 'PERSONAL_END'];
  return validTypes.includes(eventType);
}

/**
 * Validate timestamp is reasonable (not in future, not too old)
 */
export function validateTimestamp(timestamp: number, fieldName: string = 'timestamp'): number {
  if (typeof timestamp !== 'number' || isNaN(timestamp)) {
    throw new Error(`Invalid ${fieldName}: must be a number`);
  }
  
  const now = Date.now();
  const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);
  const oneHourFuture = now + (60 * 60 * 1000);
  
  if (timestamp < oneYearAgo) {
    throw new Error(`Invalid ${fieldName}: too far in the past`);
  }
  
  if (timestamp > oneHourFuture) {
    throw new Error(`Invalid ${fieldName}: cannot be in the future`);
  }
  
  return timestamp;
}

/**
 * Validate backend response structure
 */
export function validateTicketsResponse(data: any): {
  tickets: any[];
  lastSyncAt?: number;
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid server response: expected object');
  }
  
  if (!Array.isArray(data.tickets)) {
    throw new Error('Invalid server response: tickets must be an array');
  }
  
  return data;
}

/**
 * Validate sync events response
 */
export function validateSyncEventsResponse(data: any): {
  results: any[];
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid server response: expected object');
  }
  
  if (!Array.isArray(data.results)) {
    throw new Error('Invalid server response: results must be an array');
  }
  
  return data;
}

/**
 * Sanitize text input (for notes, reasons, etc.)
 */
export function sanitizeTextInput(text: string, maxLength: number = 1000): string {
  if (typeof text !== 'string') {
    return '';
  }
  
  // Remove null bytes and control characters except newline/tab
  const sanitized = text.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
  
  return sanitized.substring(0, maxLength);
}
