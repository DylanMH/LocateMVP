import { API_BASE_URL } from '../../../config/api';
import { fetchWithTimeout } from '../../../utils/fetchWithTimeout';
import { logger } from '../../../utils/logger';

// ── Types ──────────────────────────────────────────────────

export type DueUrgency = 'OVERDUE' | 'DUE_WITHIN_2_HOURS' | 'DUE_TODAY' | 'DUE_WITHIN_72_HOURS' | 'FUTURE';

export interface TechOpsSummary {
  id: string;
  name: string;
  employeeId?: string;
  areaId?: string;
  timesheetState: string;
  ticketState?: string;
  currentSessionStartedAt?: number;
  activeTicket?: {
    id: string;
    ticketNumber: string;
    address?: string;
    locatorStatus: string;
    dueAt?: number;
    dueUrgency?: DueUrgency;
  };
  today: {
    workedMinutes: number;
    completedTickets: number;
    footageFeet: number;
    lph: number;
    fph: number;
  };
  assigned: {
    open: number;
    overdue: number;
    dueSoon: number;
  };
  lastActivityAt?: number;
}

export interface OpsOverview {
  techs: {
    totalTechs: number;
    clockedIn: number;
    enroute: number;
    onsite: number;
    paused: number;
    onLunch: number;
    onPersonal: number;
  };
  tickets: {
    open: number;
    overdue: number;
    dueSoon: number;
    completedToday: number;
    totalFootageToday: number;
    highPriority: number;
  };
  needsAttention: Array<{
    type: string;
    id: string;
    label: string;
    detail: string;
    locatorStatus?: string;
    dueAt?: number;
    customers?: Array<{ id: string; utility: string }>;
  }>;
  activeTechs: TechOpsSummary[];
  teamSummary: {
    totalWorkedMinutes: number;
    totalCompletedTickets: number;
    totalFootage: number;
    openBacklog: number;
  };
}

export interface TerritoryNode {
  id: string;
  code: string;
  name: string;
  type: string;
  children: TerritoryNode[];
  techCount: number;
  supervisorName?: string;
}

export interface OpsMapMarker {
  id: string;
  lat: number;
  lng: number;
  ticketNumber: string;
  dueUrgency?: DueUrgency;
  locatorStatus: string;
  assignedTechName?: string;
  isActive: boolean;
}

// ── Ops Ticket Detail ──────────────────────────────────────

export interface OpsTicketCustomer {
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

export interface OpsTicketEvent {
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
}

export interface OpsTicketDetail {
  id: string;
  ticketNumber: string;
  ticketType: string;
  status: string;
  locatorStatus: string;
  address: string;
  lat: number;
  lng: number;
  assignedTechId: string | null;
  assignedTech: { id: string; name: string; email: string; areaId: string | null } | null;
  areaId: string | null;
  dueAt: number;
  originalDueAt?: number;
  rescheduleCount?: number;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  version: number;
  source: string;
  priority: string;
  dueUrgency?: DueUrgency;
  timeAllocation: {
    enrouteMs: number;
    onsiteMs: number;
    pausedMs: number;
    totalMs: number;
    enrouteStartedAt: number | null;
    enrouteEndedAt: number | null;
    onsiteStartedAt: number | null;
    onsiteEndedAt: number | null;
    closedAt: number | null;
  };
  customers: OpsTicketCustomer[];
  notes: Array<{ id: string; author_id: string | null; author_name: string | null; body: string; note_type: string; created_at: number }>;
  events: OpsTicketEvent[];
}

export interface OpsTechTicket {
  id: string;
  ticketNumber: string;
  ticketType: string;
  status: string;
  locatorStatus: string;
  address: string;
  lat: number;
  lng: number;
  assignedTechId: string | null;
  dueAt: number;
  dueUrgency?: DueUrgency;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  priority: string;
  payloadJson?: string;
  timeAllocation: {
    enrouteMs: number;
    onsiteMs: number;
    pausedMs: number;
    totalMs: number;
    enrouteStartedAt: number | null;
    enrouteEndedAt: number | null;
    onsiteStartedAt: number | null;
    onsiteEndedAt: number | null;
    closedAt: number | null;
  };
}

// ── Due urgency colors and labels ──────────────────────────

export const DUE_URGENCY_COLORS: Record<DueUrgency, string> = {
  OVERDUE: '#F87171',
  DUE_WITHIN_2_HOURS: '#D97706',
  DUE_TODAY: '#FACC15',
  DUE_WITHIN_72_HOURS: '#60A5FA',
  FUTURE: '#1E40AF',
};

export const DUE_URGENCY_LABELS: Record<DueUrgency, string> = {
  OVERDUE: 'Overdue',
  DUE_WITHIN_2_HOURS: 'Due < 2h',
  DUE_TODAY: 'Due Today',
  DUE_WITHIN_72_HOURS: 'Due < 72h',
  FUTURE: 'Future',
};

// ── API functions ──────────────────────────────────────────

async function opsFetch(path: string, token: string, options?: RequestInit): Promise<any> {
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ops API error ${response.status}: ${body}`);
  }
  return response.json();
}

export async function fetchOpsOverview(token: string): Promise<OpsOverview> {
  return opsFetch('/ops/me/overview', token);
}

export async function fetchOpsTechs(token: string, status?: string, limit?: number, offset?: number): Promise<{ techs: TechOpsSummary[] }> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const qs = params.toString();
  return opsFetch(`/ops/me/techs${qs ? '?' + qs : ''}`, token);
}

export async function fetchOpsTeams(token: string): Promise<{ teams: TerritoryNode[] }> {
  return opsFetch('/ops/me/teams', token);
}

export async function fetchOpsMap(token: string, filters?: { techId?: string; dueUrgency?: DueUrgency; active?: boolean }): Promise<{ markers: OpsMapMarker[]; center: { lat: number; lng: number } }> {
  const params = new URLSearchParams();
  if (filters?.techId) params.set('techId', filters.techId);
  if (filters?.dueUrgency) params.set('dueUrgency', filters.dueUrgency);
  if (filters?.active) params.set('active', 'true');
  const qs = params.toString();
  return opsFetch(`/ops/map${qs ? '?' + qs : ''}`, token);
}

export async function fetchOpsTicketDetail(token: string, ticketId: string): Promise<OpsTicketDetail> {
  return opsFetch(`/ops/tickets/${ticketId}`, token);
}

export async function fetchOpsTechTickets(token: string, techId: string): Promise<{ tickets: OpsTechTicket[] }> {
  return opsFetch(`/ops/techs/${techId}/tickets?range=all`, token);
}

export async function assignOpsTicket(token: string, ticketId: string, techId: string | null): Promise<{ message: string; ticketId: string; assignedTechId: string | null; assignedTechName: string | null }> {
  return opsFetch(`/ops/tickets/${ticketId}/assign`, token, {
    method: 'PUT',
    body: JSON.stringify({ techId }),
  });
}

export async function rescheduleOpsTicket(token: string, ticketId: string, newDueAt: number, reason?: string): Promise<any> {
  return opsFetch(`/tickets/${ticketId}/reschedule`, token, {
    method: 'POST',
    body: JSON.stringify({ newDueAt, reason, performedBy: 'supervisor' }),
  });
}
