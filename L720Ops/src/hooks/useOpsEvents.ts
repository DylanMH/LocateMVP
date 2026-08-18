import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL, getAuthToken } from "../lib/opsClient";

/**
 * Ops portal live-update feed.
 *
 * Establishes ONE SSE connection per mounted hook (keep it mounted once at the
 * layout level), then invalidates the relevant React Query cache entries when
 * server-side changes happen. Pages don't poll; they subscribe to stable query
 * keys and trust this hook to invalidate them.
 *
 * Event type → keys invalidated:
 *   - ticket.updated / ticket.created / ticket.assigned → ["ops","tickets"], ["ops","dashboard"], ["ops","techs"], ["ops","activity"]
 *   - tech.clock.changed                                → ["ops","techs"], ["ops","dashboard"], ["ops","timesheet"]
 *   - tech.updated                                      → ["ops","techs"], ["ops","dashboard"]
 *   - simulator.sync                                    → ["ops","tickets"], ["ops","dashboard"], ["simulator"]
 *   - ticket.note.added / ticket.attachment.added       → ["ops","ticket-detail"]
 *
 * Falls back to polling intervals configured on each query if the SSE socket
 * disconnects and cannot reconnect.
 */

type OpsEventHandler = (event: { type: string; payload: Record<string, unknown>; at: number }) => void;

export function useOpsEvents(onEvent?: OpsEventHandler) {
  const qc = useQueryClient();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;

    const url = `${API_BASE_URL}/ops/events?token=${encodeURIComponent(token)}`;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource(url);

      const handle = (_rawType: string, data: string) => {
        try {
          const parsed = JSON.parse(data) as {
            type: string;
            payload: Record<string, unknown>;
            at: number;
          };
          onEventRef.current?.(parsed);
          routeInvalidation(qc, parsed.type);
        } catch {
          // ignore malformed
        }
      };

      es.onmessage = (e) => handle("message", e.data);
      const types = [
        "hello",
        "ticket.updated",
        "ticket.created",
        "ticket.assigned",
        "ticket.note.added",
        "ticket.attachment.added",
        "tech.clock.changed",
        "tech.updated",
        "simulator.sync",
      ];
      for (const t of types) {
        es.addEventListener(t, (e) => handle(t, (e as MessageEvent).data));
      }

      es.onerror = () => {
        es?.close();
        es = null;
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 5000);
        }
      };
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [qc]);
}

function routeInvalidation(qc: ReturnType<typeof useQueryClient>, type: string) {
  const invalidate = (key: readonly unknown[]) =>
    qc.invalidateQueries({ queryKey: key });

  if (type.startsWith("ticket.")) {
    invalidate(["ops", "tickets"]);
    invalidate(["ops", "dashboard"]);
    invalidate(["ops", "activity"]);
    invalidate(["ops", "ticket-detail"]);
  }
  if (type === "ticket.assigned" || type === "ticket.updated" || type === "ticket.created") {
    invalidate(["ops", "techs"]);
    invalidate(["ops", "timesheet"]);
  }
  if (type === "tech.clock.changed" || type === "tech.updated") {
    invalidate(["ops", "techs"]);
    invalidate(["ops", "dashboard"]);
    invalidate(["ops", "timesheet"]);
  }
  if (type === "simulator.sync") {
    invalidate(["ops", "tickets"]);
    invalidate(["ops", "dashboard"]);
    invalidate(["simulator"]);
  }
}
