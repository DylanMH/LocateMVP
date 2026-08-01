/* UUID/requestId helper for offline-first event IDs. */

/**
 * Generates a requestId for outbox events.
 * Uses `crypto.randomUUID` when available; falls back to `uuid` package.
 */
export function createRequestId(): string {
    const cryptoAny = globalThis.crypto as unknown as { randomUUID?: () => string } | undefined;
    if (cryptoAny?.randomUUID) return cryptoAny.randomUUID();

    // Fallback: stable-enough unique id for local-only/offline MVP (no external dependency).
    const rand = Math.random().toString(16).slice(2);
    const time = Date.now().toString(16);
    return `req_${time}_${rand}`;
}
