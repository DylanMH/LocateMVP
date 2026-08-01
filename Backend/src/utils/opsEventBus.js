/**
 * In-process pub/sub for the L720 Ops portal SSE stream.
 *
 * Event shape: { type: string, payload: object, at: number }
 * Well-known types:
 *   - ticket.updated          { ticketId, ticketNumber, status, locatorStatus, assignedTechId }
 *   - ticket.created          { ticketId, ticketNumber, source }
 *   - ticket.assigned         { ticketId, techId, byUserId }
 *   - tech.clock.changed      { userId, sessionId, eventType, occurredAt }
 *   - tech.updated            { userId }
 *   - ticket_event.created    { ticketId, type }
 *   - simulator.sync          { ingested, updated, reconciledRemoved }
 *
 * Consumers register via subscribe(fn) and must call the returned unsubscribe()
 * when done. The bus holds no replay buffer on purpose — SSE clients that miss
 * events fall back to TanStack Query's polling intervals.
 */

import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitOpsEvent(type, payload = {}) {
  const event = { type, payload, at: Date.now() };
  bus.emit("event", event);
  return event;
}

export function subscribeOpsEvents(handler) {
  bus.on("event", handler);
  return () => bus.off("event", handler);
}
