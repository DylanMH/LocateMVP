/**
 * Idempotency Service
 *
 * Tracks processed events by requestId to prevent duplicate processing.
 * Uses SQLite for persistence (survives server restart) with an in-memory
 * LRU cache for performance.
 */

let db = null;
const EVENT_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MEMORY_CACHE_MAX = 5000;

// In-memory fast-path cache. Entries have { timestamp, result }.
const memoryCache = new Map();

let stmtCheck = null;
let stmtInsert = null;
let stmtGet = null;
let stmtCleanup = null;

/**
 * Initialize the idempotency store with a database instance.
 * Must be called once at startup before any other functions.
 */
export function initIdempotencyStore(database) {
  db = database;
  stmtCheck = db.prepare(
    "SELECT 1 FROM idempotency_records WHERE request_id = ? AND created_at > ?"
  );
  stmtInsert = db.prepare(
    "INSERT OR IGNORE INTO idempotency_records (request_id, result_json, created_at) VALUES (?, ?, ?)"
  );
  stmtGet = db.prepare(
    "SELECT result_json FROM idempotency_records WHERE request_id = ? AND created_at > ?"
  );
  stmtCleanup = db.prepare(
    "DELETE FROM idempotency_records WHERE created_at < ?"
  );
}

function ensureInitialized() {
  if (!db) throw new Error("Idempotency store not initialized — call initIdempotencyStore(db) at startup");
}

function cutoff() {
  return Date.now() - EVENT_TTL;
}

/**
 * Check if an event has already been processed.
 */
export function isEventProcessed(requestId) {
  ensureInitialized();

  // Fast path: in-memory cache.
  const entry = memoryCache.get(requestId);
  if (entry) {
    if (Date.now() - entry.timestamp > EVENT_TTL) {
      memoryCache.delete(requestId);
      return false;
    }
    return true;
  }

  // Slow path: check SQLite.
  const row = stmtCheck.get(requestId, cutoff());
  if (row) {
    // Re-populate cache for next time.
    memoryCache.set(requestId, { timestamp: Date.now(), result: null });
    return true;
  }
  return false;
}

/**
 * Mark an event as processed.
 */
export function markEventProcessed(requestId, result) {
  ensureInitialized();

  const now = Date.now();

  // Write to in-memory cache.
  memoryCache.set(requestId, { timestamp: now, result });
  if (memoryCache.size > MEMORY_CACHE_MAX) {
    // Evict oldest 20%.
    const keys = [...memoryCache.keys()];
    const toEvict = Math.floor(MEMORY_CACHE_MAX * 0.2);
    for (let i = 0; i < toEvict; i++) memoryCache.delete(keys[i]);
  }

  // Persist to SQLite (INSERT OR IGNORE prevents duplicates).
  stmtInsert.run(requestId, JSON.stringify(result), now);

  // Periodically clean old SQLite records (every 1000 writes).
  if (memoryCache.size % 1000 === 0) {
    stmtCleanup.run(cutoff());
  }
}

/**
 * Get the cached result for a processed event.
 */
export function getProcessedEventResult(requestId) {
  ensureInitialized();

  // Fast path: in-memory cache.
  const entry = memoryCache.get(requestId);
  if (entry) {
    if (Date.now() - entry.timestamp > EVENT_TTL) {
      memoryCache.delete(requestId);
      return null;
    }
    return entry.result;
  }

  // Slow path: check SQLite.
  const row = stmtGet.get(requestId, cutoff());
  if (row) {
    try { return JSON.parse(row.result_json); } catch { return null; }
  }
  return null;
}

/**
 * Clear all processed events (for testing).
 */
export function clearProcessedEvents() {
  memoryCache.clear();
  if (db) {
    db.prepare("DELETE FROM idempotency_records").run();
  }
}

/**
 * Get cache statistics.
 */
export function getCacheStats() {
  ensureInitialized();
  let oldestTimestamp = null;
  for (const entry of memoryCache.values()) {
    if (!oldestTimestamp || entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
    }
  }
  const sqliteCount = db.prepare("SELECT COUNT(*) as c FROM idempotency_records").get().c;
  return {
    memorySize: memoryCache.size,
    sqliteSize: sqliteCount,
    oldestEntry: oldestTimestamp,
  };
}
