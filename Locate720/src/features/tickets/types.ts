/* Tickets domain types for the offline-first Tickets feature. */

export type TicketStatus =
    | "ASSIGNED"
    | "PAUSED"
    | "ENROUTE"
    | "ONSITE"
    | "CLOSED";

// 811-standard ticket types. "Original" is NOT a type — it is a lineage
// concept (the root of a chain, tracked via rootTicketId / sequenceNumber).
// Original-eligible (first-call): NORMAL, EMERGENCY, DIGUP, NON_COMPLIANT.
// Linked/derived: UPDATE, UPDATE_REMARK, RECALL, NO_RESPONSE.
// ORIGINAL/CORRECTION are kept as legacy aliases for back-compat with
// pre-811-standard local rows.
export type TicketType =
    | "NORMAL"
    | "EMERGENCY"
    | "DIGUP"
    | "NON_COMPLIANT"
    | "UPDATE"
    | "UPDATE_REMARK"
    | "RECALL"
    | "NO_RESPONSE"
    | "ORIGINAL" // legacy — treated as NORMAL
    | "CORRECTION"; // legacy — treated as RECALL

export type TicketViewStatusFilter = "OPEN" | "CLOSED";
export type TicketAssignedFilter = "MINE" | "ALL";

// v1.7 ticket filter system (plan §21-23). These are the technician-
// selectable filters applied AFTER assignment and active/closed split.
export type DueFilterCategory =
    | "ALL"
    | "OVERDUE"
    | "DUE_WITHIN_2_HOURS"
    | "DUE_TODAY"
    | "DUE_WITHIN_72_HOURS"
    | "FUTURE";

export type RescheduledFilterCategory = "ALL" | "RESCHEDULED" | "NOT_RESCHEDULED";

export interface TicketFilters {
    contractor: string | null;       // case-insensitive contractor name, or null = any
    due: DueFilterCategory;
    rescheduled: RescheduledFilterCategory;
    emergency: boolean;              // ticket type EMERGENCY
    noResponse: boolean;             // ticket type NO_RESPONSE
}

export const NO_FILTERS: TicketFilters = {
    contractor: null,
    due: "ALL",
    rescheduled: "ALL",
    emergency: false,
    noResponse: false,
};

export function countActiveFilters(filters: TicketFilters): number {
    let count = 0;
    if (filters.contractor) count++;
    if (filters.due !== "ALL") count++;
    if (filters.rescheduled !== "ALL") count++;
    if (filters.emergency) count++;
    if (filters.noResponse) count++;
    return count;
}

export function hasActiveFilters(filters: TicketFilters): boolean {
    return countActiveFilters(filters) > 0;
}

export type UtilityType = "ELECTRIC" | "FIBER" | "GAS" | "COPPER" | "WATER" | "SEWER";

export interface Customer {
    id: string;
    name: string;
    accountNumber: string;
    utility: UtilityType;
}

export interface TicketScopeBounds {
    latMin: number;
    latMax: number;
    lngMin: number;
    lngMax: number;
}

export interface OriginalTicketContractorContact {
    name?: string;
    email?: string;
}

export interface OriginalTicketContractor {
    name?: string;
    phone?: string;
    contact?: OriginalTicketContractorContact;
}

export interface OriginalTicketMemberLike {
    id: string;
    customerName?: string;
    companyName?: string;
    company_name?: string;
    utility?: UtilityType | string;
    utilityType?: UtilityType | string;
    utility_type?: UtilityType | string;
    accountNumber?: string;
    account_number?: string;
    memberCode?: string;
    member_code?: string;
}

export interface OriginalTicketData {
    payload?: Record<string, unknown>;
    payloadJson?: string;
    contractor?: string | OriginalTicketContractor;
    members?: OriginalTicketMemberLike[];
    [key: string]: unknown;
}

export interface TicketClosedInfo {
    closedByName: string;
    closedAt: string; // ISO string
}

export type TicketAttachmentKind = "PHOTO" | "PDF" | "OTHER";

export interface TicketAttachmentLocation {
    lat: number;
    lng: number;
}

export interface TicketAttachment {
    id: string;
    kind: TicketAttachmentKind;
    fileName: string;
    createdAt: string; // ISO
    localUri?: string; // device file path for local preview
    remoteUrl?: string; // server URL once uploaded (future)
    mimeType?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    uploadedByUserId?: string;
    uploadedByName?: string;
    location?: TicketAttachmentLocation;
    syncState?: "PENDING" | "SYNCED" | "FAILED";
}

export type MarkingStatus = "MARKED" | "NOT_MARKED" | "NOT_YET_MARKED" | "";

export type MarkingResult =
  | "PAINT_AND_FLAG"
  | "PAINT_ONLY"
  | "FLAG_ONLY"
  | "EXCAVATION_SITE_CLEAR"
  | "UNLOCATABLE"
  | "NO_ACCESS"
  | "OVERHEAD_NO_FACILITIES"
  | "MEETING_WITH_CONTRACTOR"
  | "";

export interface CustomerMarkingData {
    status: MarkingStatus;
    result: MarkingResult;
    minutes?: string;
    footage?: string;
    completed?: boolean;
    closedByTechName?: string;
}

export type CustomerMarkingByCustomerId = Record<string, CustomerMarkingData>;

export interface TicketPayload {
    customers?: Customer[];
    customerMarking?: CustomerMarkingByCustomerId;
    customerMarkings?: CustomerMarkingByCustomerId;
    scope?: TicketScopeBounds | null;
    enrouteStartedAt?: number;
    enrouteEndedAt?: number;
    onsiteStartedAt?: number;
    onsiteEndedAt?: number;
    closedAt?: number;
    closedByName?: string;
    pauseEvents?: Array<{
        start: number;
        end?: number;
    }>;
    workType?: string;
    contractor?: string;
    contractorPhone?: string;
    contactName?: string;
    contactEmail?: string;
    markingInstructions?: string;
    originalTicketData?: OriginalTicketData;
    [key: string]: unknown;
}

export interface TicketDisplayData {
    payload: TicketPayload;
    customers: Customer[];
    contractor: string;
    contractorPhone: string;
    contactName: string;
    contactEmail: string;
    markingInstructions: string;
    workType: string;
}

export interface Ticket {
    id: string;
    ticketNumber: string;
    contractor: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    latitude: number;
    longitude: number;
    createdAt: string; // ISO
    dueAt: string; // ISO
    status: TicketStatus;
    customers: Customer[];
    assignedToUserId: string;
    markingInstructions?: string;
    notes?: string;
    attachments?: TicketAttachment[];
    closedInfo?: TicketClosedInfo;
    onsiteStartedAt?: string; // ISO - tracks when user went ONSITE
    customerMarkings?: Record<string, CustomerMarkingData>;
}

export type TicketEventType = "TICKET_STATUS_SET";

export interface TicketStatusSetEvent {
    type: "TICKET_STATUS_SET";
    requestId: string;
    ticketId: string;
    nextStatus: TicketStatus;
    occurredAt: string; // ISO
}

export type TicketEvent = TicketStatusSetEvent;

export type SyncState = "synced" | "syncing" | "offline" | "pending";

export interface SyncIndicatorState {
    state: SyncState;
    pendingCount: number;
}
