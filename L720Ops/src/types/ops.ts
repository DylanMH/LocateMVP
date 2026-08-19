import type {
  LocatorStatus,
  Priority,
  TicketSource,
  TicketStatus,
  TicketType,
} from "./ticket";
import type { AreaId, TechRole } from "./tech";

export type ClockState =
  | "CLOCKED_IN"
  | "CLOCKED_OUT"
  | "ON_LUNCH"
  | "ON_PERSONAL";

export interface RangeSummary {
  startMs: number;
  endMs: number;
  rangeKey: string;
  label: string;
}

export interface CurrentSession {
  sessionId: string;
  clockInAt: number;
  clockOutAt?: number | null;
  elapsedMs: number;
  onBreak: boolean;
  breakType: "LUNCH" | "PERSONAL" | null;
  breakStartedAt: number | null;
  clockInReason: string | null;
  allocationType: string | null;
  otherReason: string | null;
  allocationStartedAt: number | null;
  allocationElapsedMs: number;
  clockOutTicket: { id: string; ticketNumber: string } | null;
  currentTicket: CurrentTicket | null;
}

export interface CurrentTicket {
  id: string;
  ticketNumber: string;
  locatorStatus: LocatorStatus;
  enrouteStartedAt: number | null;
  onsiteStartedAt: number | null;
}

export interface DashboardStats {
  range: RangeSummary;
  techs: {
    total: number;
    clockedIn: number;
    onLunch: number;
    onPersonal: number;
    clockedOut: number;
  };
  tickets: {
    total: number;
    byLocatorStatus: Record<LocatorStatus, number>;
    unassigned: number;
    createdInRange: number;
    closedInRange: number;
  };
  production: {
    footageInRange: number;
    locatesClosedInRange: number;
    utilityMinutesInRange: number;
    avgLph: number;
    avgFph: number;
  };
  areas: Array<{
    areaId: AreaId;
    techs: number;
    openTickets: number;
    closedInRange: number;
  }>;
}

export interface AssignedTerritory {
  id: string;
  name: string;
  code: string;
  type: string;
  parentTerritoryId: string | null;
}

export interface TechStatusRow {
  id: string;
  name: string;
  email: string;
  areaId: AreaId | null;
  clockStatus: ClockState;
  currentSession: CurrentSession | null;
  currentTicket: CurrentTicket | null;
  assignedTerritories: AssignedTerritory[];
  activeTickets: number;
}

export interface TechRow {
  id: string;
  name: string;
  email: string;
  role: TechRole;
  areaId: AreaId | null;
  supervisorId: string | null;
  createdAt: number;
  clockStatus: ClockState;
  currentSession: CurrentSession | null;
  currentTicket: CurrentTicket | null;
  assignedTerritories: AssignedTerritory[];
  ticketsOnBoard: number;
  ticketsClosedInRange: number;
  ticketsTotalClosed: number;
  locatesClosed: number;
  footage: number;
  utilityMinutes: number;
  workedMs: number;
  lunchMs: number;
  personalMs: number;
  productiveMs: number;
  lph: number;
  fph: number;
}

export interface TechsResponse {
  range: RangeSummary;
  techs: TechRow[];
}

export interface TicketListRow {
  id: string;
  ticketNumber: string;
  ticketType: TicketType;
  status: TicketStatus;
  locatorStatus: LocatorStatus;
  address: string;
  lat: number;
  lng: number;
  assignedTechId: string | null;
  assignedTech: { id: string; name: string; areaId: AreaId | null } | null;
  areaId: AreaId | null;
  dueAt: number;
  dueUrgency?: string;
  originalDueAt?: number;
  rescheduleCount?: number;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  version: number;
  source: TicketSource;
  externalTicketId?: string;
  priority: Priority;
  payloadJson: string;
}

export interface TicketListResponse {
  tickets: TicketListRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface TicketTimeAllocation {
  enrouteMs: number;
  onsiteMs: number;
  pausedMs: number;
  totalMs: number;
  enrouteStartedAt: number | null;
  enrouteEndedAt: number | null;
  onsiteStartedAt: number | null;
  onsiteEndedAt: number | null;
  closedAt: number | null;
}

export interface TicketCustomerRow {
  customerId: string;
  customerName: string | null;
  utilityType: string | null;
  status: string;
  result: string;
  minutes: string | number;
  footage: string | number;
  completed: boolean;
  notes: string;
}

export interface TicketNoteRow {
  id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  note_type: "INTERNAL" | "DISPATCH";
  created_at: number;
}

export interface TicketAttachmentRow {
  id: string;
  uploader_id: string | null;
  uploader_name: string | null;
  kind: string;
  file_name: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  file_size: number | null;
  lat: number | null;
  lng: number | null;
  captured_at: number | null;
  created_at: number;
}

export interface TicketDetailResponse extends TicketListRow {
  timeAllocation: TicketTimeAllocation;
  customers: TicketCustomerRow[];
  productionLedger: Array<{
    id: string;
    userId: string | null;
    customerId: string;
    customerName: string | null;
    utilityType: string | null;
    minutesDelta: number;
    footageDelta: number;
    completedDelta: number;
    sourceEventType: string;
    occurredAt: number;
  }>;
  notes: TicketNoteRow[];
  attachments: TicketAttachmentRow[];
  events: Array<{
    id: string;
    type: string;
    oldStatus: string | null;
    newStatus: string | null;
    oldLocatorStatus: string | null;
    newLocatorStatus: string | null;
    userId: string | null;
    notes: string | null;
    payload: Record<string, unknown>;
    createdAt: number;
  }>;
}

export interface ActivityRow {
  id: string;
  ticketId: string;
  ticketNumber: string | null;
  type: string;
  oldStatus: string | null;
  newStatus: string | null;
  oldLocatorStatus: string | null;
  newLocatorStatus: string | null;
  userId: string | null;
  userName: string | null;
  notes: string | null;
  createdAt: number;
}

export interface CustomerSummaryRow {
  customerName: string | null;
  utilityType: string | null;
  footage: number;
  minutes: number;
  locatesClosed: number;
  ticketCount: number;
}
