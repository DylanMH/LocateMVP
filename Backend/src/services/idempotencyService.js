/**
 * Idempotency Service
 * 
 * Tracks processed events by requestId to prevent duplicate processing.
 * Uses in-memory cache with TTL for performance.
 */

const processedEvents = new Map();
const EVENT_TTL = 24 * 60 * 60 * 1000;

/**
 * Check if an event has already been processed
 * @param {string} requestId - The event's unique request ID
 * @returns {boolean}
 */
export function isEventProcessed(requestId) {
  const entry = processedEvents.get(requestId);
  
  if (!entry) {
    return false;
  }

  if (Date.now() - entry.timestamp > EVENT_TTL) {
    processedEvents.delete(requestId);
    return false;
  }

  return true;
}

/**
 * Mark an event as processed
 * @param {string} requestId - The event's unique request ID
 * @param {object} result - The processing result
 */
export function markEventProcessed(requestId, result) {
  processedEvents.set(requestId, {
    timestamp: Date.now(),
    result,
  });

  cleanupOldEntries();
}

/**
 * Get the cached result for a processed event
 * @param {string} requestId - The event's unique request ID
 * @returns {object|null}
 */
export function getProcessedEventResult(requestId) {
  const entry = processedEvents.get(requestId);
  
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > EVENT_TTL) {
    processedEvents.delete(requestId);
    return null;
  }

  return entry.result;
}

/**
 * Clean up old entries from the cache
 */
function cleanupOldEntries() {
  if (processedEvents.size < 1000) {
    return;
  }

  const now = Date.now();
  const toDelete = [];

  for (const [requestId, entry] of processedEvents.entries()) {
    if (now - entry.timestamp > EVENT_TTL) {
      toDelete.push(requestId);
    }
  }

  toDelete.forEach(id => processedEvents.delete(id));
}

/**
 * Clear all processed events (for testing)
 */
export function clearProcessedEvents() {
  processedEvents.clear();
}

/**
 * Get cache statistics
 * @returns {{ size: number, oldestEntry: number|null }}
 */
export function getCacheStats() {
  let oldestTimestamp = null;

  for (const entry of processedEvents.values()) {
    if (!oldestTimestamp || entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
    }
  }

  return {
    size: processedEvents.size,
    oldestEntry: oldestTimestamp,
  };
}
