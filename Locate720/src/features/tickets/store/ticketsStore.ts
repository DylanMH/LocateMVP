/* Local-first Tickets store with optimistic updates + outbox. */

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

import { seedTickets } from "../data/seedTickets";
import { canTransitionStatus, isTicketClosed } from "../domain/statusMachine";
import { createRequestId } from "../utils/uuid";
import type { CustomerMarkingByCustomerId, SyncIndicatorState, Ticket, TicketEvent, TicketStatus } from "../types";

export interface TicketsRepository {
    getTickets: () => Ticket[];
    getTicketById: (id: string) => Ticket | undefined;
    getSyncIndicatorState: () => SyncIndicatorState;
    setTicketStatus: (ticketId: string, nextStatus: TicketStatus) => { ok: true } | { ok: false; reason: string };
    saveCustomerMarkings: (ticketId: string, markings: CustomerMarkingByCustomerId) => void;
}

interface TicketsStoreState {
    ticketsById: Record<string, Ticket>;
    ticketIds: string[];
    outbox: TicketEvent[];
    isOffline: boolean;
    isSyncing: boolean;
}

function seedToState() {
    const ticketsById: Record<string, Ticket> = {};
    const ticketIds: string[] = [];

    for (const t of seedTickets) {
        ticketsById[t.id] = t;
        ticketIds.push(t.id);
    }

    return { ticketsById, ticketIds };
}

const TicketsRepositoryContext = createContext<TicketsRepository | null>(null);

/**
 * Provides the local-first Tickets repository.
 * This is the seam where a WatermelonDB-backed implementation will plug in later.
 */
export function TicketsProvider({ children }: { children: React.ReactNode }) {
    const seeded = useMemo(() => seedToState(), []);

    const [state, setState] = useState<TicketsStoreState>({
        ticketsById: seeded.ticketsById,
        ticketIds: seeded.ticketIds,
        outbox: [],
        isOffline: false,
        isSyncing: false,
    });

    const getTickets = useCallback((): Ticket[] => {
        return state.ticketIds
            .map((id) => state.ticketsById[id])
            .filter((t): t is Ticket => Boolean(t));
    }, [state.ticketIds, state.ticketsById]);

    const getTicketById = useCallback((id: string): Ticket | undefined => {
        return state.ticketsById[id];
    }, [state.ticketsById]);

    const getSyncIndicatorState = useCallback((): SyncIndicatorState => {
        const pendingCount = state.outbox.length;

        if (state.isOffline) return { state: "offline", pendingCount };
        if (state.isSyncing) return { state: "syncing", pendingCount };
        if (pendingCount > 0) return { state: "pending", pendingCount };
        return { state: "synced", pendingCount: 0 };
    }, [state.isOffline, state.isSyncing, state.outbox.length]);

    const setTicketStatus = useCallback(
        (ticketId: string, nextStatus: TicketStatus) => {
            const existing = state.ticketsById[ticketId];
            if (!existing) return { ok: false as const, reason: "Ticket not found" };
            if (isTicketClosed(existing.status)) return { ok: false as const, reason: "Ticket is closed" };
            if (!canTransitionStatus(existing.status, nextStatus)) {
                return { ok: false as const, reason: `Invalid transition: ${existing.status} -> ${nextStatus}` };
            }

            // Business rule: can't go ENROUTE or ONSITE if already ONSITE for another ticket
            const onsiteTicket = state.ticketIds
                .filter((id) => id !== ticketId)
                .map((id) => state.ticketsById[id])
                .find((t) => t && t.status === "ONSITE");

            if (onsiteTicket && (nextStatus === "ENROUTE" || nextStatus === "ONSITE")) {
                return {
                    ok: false as const,
                    reason: `You are currently on site at ${onsiteTicket.addressLine1}. Please go to that ticket and allocate all time on site before moving to another ticket.`,
                };
            }

            const occurredAt = new Date().toISOString();
            const event: TicketEvent = {
                type: "TICKET_STATUS_SET",
                requestId: createRequestId(),
                ticketId,
                nextStatus,
                occurredAt,
            };

            setState((prev) => {
                const current = prev.ticketsById[ticketId];
                if (!current) return prev;

                // Business rule: only one ticket may be ENROUTE at a time.
                // If we are setting this ticket to ENROUTE, automatically pause any other ENROUTE ticket.
                const shouldPauseOthers = nextStatus === "ENROUTE";
                const pausedUpdates: { ticketId: string; event: TicketEvent }[] = [];

                if (shouldPauseOthers) {
                    for (const otherId of prev.ticketIds) {
                        if (otherId === ticketId) continue;
                        const other = prev.ticketsById[otherId];
                        if (!other) continue;
                        if (other.status !== "ENROUTE") continue;

                        // ENROUTE -> PAUSED is always allowed in our state machine.
                        pausedUpdates.push({
                            ticketId: otherId,
                            event: {
                                type: "TICKET_STATUS_SET",
                                requestId: createRequestId(),
                                ticketId: otherId,
                                nextStatus: "PAUSED",
                                occurredAt,
                            },
                        });
                    }
                }

                // Track ONSITE start time
                const updated: Ticket = {
                    ...current,
                    status: nextStatus,
                    onsiteStartedAt: nextStatus === "ONSITE" ? occurredAt : current.onsiteStartedAt,
                };

                const nextTicketsById: Record<string, Ticket> = {
                    ...prev.ticketsById,
                    [ticketId]: updated,
                };

                for (const p of pausedUpdates) {
                    const t = nextTicketsById[p.ticketId];
                    if (!t) continue;
                    nextTicketsById[p.ticketId] = {
                        ...t,
                        status: "PAUSED",
                    };
                }

                return {
                    ...prev,
                    ticketsById: nextTicketsById,
                    outbox: [...prev.outbox, ...pausedUpdates.map((p) => p.event), event],
                };
            });

            return { ok: true as const };
        },
        [state.ticketsById, state.ticketIds]
    );

    const saveCustomerMarkings = useCallback((ticketId: string, markings: CustomerMarkingByCustomerId) => {
        setState((prev) => {
            const ticket = prev.ticketsById[ticketId];
            if (!ticket) return prev;

            return {
                ...prev,
                ticketsById: {
                    ...prev.ticketsById,
                    [ticketId]: {
                        ...ticket,
                        customerMarkings: markings,
                    },
                },
            };
        });
    }, []);

    const repo = useMemo<TicketsRepository>(() => {
        return {
            getTickets,
            getTicketById,
            getSyncIndicatorState,
            setTicketStatus,
            saveCustomerMarkings,
        };
    }, [getTickets, getTicketById, getSyncIndicatorState, setTicketStatus, saveCustomerMarkings]);

    return React.createElement(TicketsRepositoryContext.Provider, { value: repo }, children);
}

/** Returns the Tickets repository API (local-first). */
export function useTicketsRepository(): TicketsRepository {
    const repo = useContext(TicketsRepositoryContext);
    if (!repo) throw new Error("useTicketsRepository must be used within TicketsProvider");
    return repo;
}
