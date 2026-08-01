/* Formatting helpers for Tickets UI. */

import type { Ticket, TicketStatus } from "../types";

export function formatTicketTitle(ticket: Ticket): string {
    return `Ticket ${ticket.ticketNumber}`;
}

export function formatTicketAddressSummary(ticket: Ticket): string {
    return `${ticket.addressLine1}, ${ticket.city}, ${ticket.state}`;
}

export function formatTicketStatusLabel(status: TicketStatus): string {
    switch (status) {
        case "ASSIGNED":
            return "ASSIGNED";
        case "PAUSED":
            return "PAUSED";
        case "ENROUTE":
            return "EN ROUTE";
        case "ONSITE":
            return "ON SITE";
        case "CLOSED":
            return "CLOSED";
    }

    return status;
}

export function formatShortDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";

    const hours = d.getHours();
    const minutes = d.getMinutes();
    const hh = hours % 12 || 12;
    const mm = String(minutes).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";

    const month = d.getMonth() + 1;
    const day = d.getDate();

    return `${month}/${day} ${hh}:${mm} ${ampm}`;
}

export function formatShortTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";

    const hours = d.getHours();
    const minutes = d.getMinutes();
    const hh = hours % 12 || 12;
    const mm = String(minutes).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";

    return `${hh}:${mm} ${ampm}`;
}
