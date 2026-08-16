// 811-standard ticket types. "Original" is NOT a type — it is a lineage
// concept (the root of a chain, tracked via rootTicketId / sequenceNumber).
// Original-eligible (first-call): NORMAL, EMERGENCY, DIGUP, NON_COMPLIANT.
// Linked/derived: UPDATE, UPDATE_REMARK, RECALL, NO_RESPONSE.
export type TicketType =
  | "NORMAL"
  | "EMERGENCY"
  | "DIGUP"
  | "NON_COMPLIANT"
  | "UPDATE"
  | "UPDATE_REMARK"
  | "RECALL"
  | "NO_RESPONSE";

// Human-readable label for a ticket type. Legacy ORIGINAL/CORRECTION values
// (from pre-811-standard data) are normalized for display.
export function formatTicketType(ticketType?: string): string {
  if (!ticketType) return "Normal";
  switch (ticketType) {
    case "NORMAL":
    case "ORIGINAL": // legacy
      return "Normal";
    case "EMERGENCY":
      return "Emergency";
    case "DIGUP":
      return "Dig Up";
    case "NON_COMPLIANT":
      return "Non Compliant";
    case "UPDATE":
      return "Update";
    case "UPDATE_REMARK":
      return "Update / Remark";
    case "RECALL":
    case "CORRECTION": // legacy — CORRECTION's meaning matches 811 RECALL
      return "Recall";
    case "NO_RESPONSE":
      return "No Response";
    default:
      return ticketType;
  }
}

// Tailwind badge classes for a ticket type. Used by ticket type badges across
// the ops portal. Legacy ORIGINAL/CORRECTION map to their normalized buckets.
export function ticketTypeBadgeClass(ticketType?: string): string {
  switch (ticketType) {
    case "EMERGENCY":
      return "bg-red-100 text-red-800";
    case "DIGUP":
      return "bg-orange-100 text-orange-800";
    case "NON_COMPLIANT":
      return "bg-amber-100 text-amber-800";
    case "UPDATE":
    case "UPDATE_REMARK":
      return "bg-sky-100 text-sky-800";
    case "RECALL":
    case "CORRECTION": // legacy
      return "bg-purple-100 text-purple-800";
    case "NO_RESPONSE":
      return "bg-rose-100 text-rose-800";
    case "NORMAL":
    case "ORIGINAL": // legacy
    default:
      return "bg-blue-100 text-blue-800";
  }
}
export type TicketStatus =
  | "OPEN"
  | "ASSIGNED"
  | "EN_ROUTE"
  | "ONSITE"
  | "CLOSED"
  | "UNABLE";
export type LocatorStatus =
  | "ASSIGNED"
  | "ENROUTE"
  | "ONSITE"
  | "PAUSED"
  | "CLOSED"
  | "UNABLE";
export type Priority = "LOW" | "NORMAL" | "HIGH" | "EMERGENCY";
export type TicketSource = "811" | "INTERNAL";

export interface CustomerMarking {
  utility: string;
  footage?: number;
  notes?: string;
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  ticketType: TicketType;
  status: TicketStatus;
  locatorStatus: LocatorStatus;
  address: string;
  lat: number;
  lng: number;
  assignedTechId: string | null;
  assignedTech?: {
    id: string;
    name: string;
    areaId: string;
  };
  areaId: string | null;
  dueAt: number;
  createdAt: number;
  updatedAt: number;
  version: number;
  source: TicketSource;
  externalTicketId?: string;
  priority: Priority;
  payloadJson: string;
  adminNotes?: string;
  // Lineage (linked-ticket model) \u2014 see docs/linked-tickets-architecture.md.
  rootTicketId?: string;
  parentTicketId?: string | null;
  sequenceNumber?: number;
  externalRootNumber?: string;
}

export interface TicketChainRow {
  id: string;
  ticketNumber: string;
  ticketType: string;
  status: string;
  locatorStatus: string;
  address: string | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  rootTicketId: string;
  parentTicketId: string | null;
  sequenceNumber: number;
  externalRootNumber: string | null;
  assignedTech: { id: string; name: string; areaId: string | null } | null;
  minutes: number;
  footage: number;
}

export interface TicketEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface TicketFilters {
  status?: TicketStatus;
  areaId?: string;
  assignedTechId?: string;
  source?: TicketSource;
  search?: string;
  page?: number;
  limit?: number;
}

export interface TicketDetail extends Ticket {
  events: TicketEvent[];
}
