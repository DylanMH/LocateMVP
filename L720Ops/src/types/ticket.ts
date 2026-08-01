export type TicketType =
  | "ORIGINAL"
  | "NORMAL" // legacy alias for ORIGINAL
  | "UPDATE"
  | "UPDATE_REMARK"
  | "NO_RESPONSE"
  | "RECALL"
  | "CORRECTION"
  | "EMERGENCY";
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
