import type { QueryParams } from "../lib/opsClient";
import { opsFetch, opsFetchBlob } from "../lib/opsClient";
import type {
  ActivityRow,
  CustomerSummaryRow,
  DashboardStats,
  TechRow,
  TechStatusRow,
  TechsResponse,
  TicketDetailResponse,
  TicketListResponse,
  RangeSummary,
} from "../types/ops";

export const OpsService = {
  // Dashboard
  getDashboardStats(range: QueryParams) {
    return opsFetch<DashboardStats>("/ops/dashboard/stats", range);
  },
  getTechStatus() {
    return opsFetch<TechStatusRow[]>("/ops/dashboard/tech-status");
  },
  getActivity(limit = 50) {
    return opsFetch<ActivityRow[]>("/ops/dashboard/activity", { limit });
  },

  // Techs
  getTechs(params: QueryParams) {
    return opsFetch<TechsResponse>("/ops/techs", params);
  },
  getTech(id: string, range: QueryParams) {
    return opsFetch<TechRow & { supervisorName: string | null; range: RangeSummary; productivity: TechRow }>(
      `/ops/techs/${id}`,
      range,
    );
  },
  getTechTickets(id: string, params: QueryParams) {
    return opsFetch<{ tickets: TicketDetailResponse[] }>(
      `/ops/techs/${id}/tickets`,
      params,
    );
  },
  getTechTimesheet(id: string, range: QueryParams) {
    return opsFetch<{
      range: RangeSummary;
      sessions: Array<{
        id: string;
        date: string;
        clockInAt: number;
        clockOutAt: number | null;
        status: string;
        clockInReason?: string | null;
        allocationType?: string | null;
        otherReason?: string | null;
        workedMs: number;
        lunchMs: number;
        personalMs: number;
        productiveMs: number;
        breakSegments: Array<{
          id: string;
          type: "LUNCH" | "PERSONAL";
          startedAt: number;
          endedAt: number | null;
          reason: string | null;
        }>;
        allocationSegments?: Array<{
          id: string;
          allocationType: string;
          otherReason: string | null;
          startedAt: number;
          endedAt: number | null;
        }>;
        allocationBreakdown?: Array<{
          type: string;
          ms: number;
          segments: Array<{
            id: string;
            startedAt: number;
            endedAt: number | null;
            otherReason: string | null;
          }>;
        }>;
      }>;
      totals: {
        workedMs: number;
        lunchMs: number;
        personalMs: number;
        productiveMs: number;
        allocationBreakdown?: Array<{ type: string; ms: number }>;
      };
    }>(`/ops/techs/${id}/timesheet`, range);
  },
  updateTech(id: string, body: { areaId?: string | null; supervisorId?: string | null }) {
    return opsFetch<{ ok: boolean; userId: string }>(`/ops/techs/${id}`, undefined, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },
  getTechsLocations() {
    return opsFetch<{
      techs: Array<{
        userId: string;
        name: string;
        email: string;
        role: string;
        clockInAt: number;
        allocationType: string | null;
        latitude: number;
        longitude: number;
        accuracy?: number;
        heading?: number;
        speed?: number;
        recordedAt: number;
      }>;
    }>("/ops/techs-locations");
  },
  getTechRoute(id: string, params?: QueryParams) {
    return opsFetch<{
      points: Array<{
        id: string;
        userId: string;
        sessionId: string;
        latitude: number;
        longitude: number;
        accuracy?: number;
        heading?: number;
        speed?: number;
        recordedAt: number;
      }>;
    }>(`/ops/techs/${id}/route`, params);
  },

  // Tickets
  getTickets(params: QueryParams) {
    return opsFetch<TicketListResponse>("/ops/tickets", params);
  },
  getTicket(id: string) {
    return opsFetch<TicketDetailResponse>(`/ops/tickets/${id}`);
  },
  assignTicket(ticketId: string, techId: string | null) {
    return opsFetch<{ ticketId: string; assignedTechId: string | null }>(
      `/ops/tickets/${ticketId}/assign`,
      undefined,
      {
        method: "PUT",
        body: JSON.stringify({ techId }),
      },
    );
  },
  bulkAssign(ticketIds: string[], techId: string | null) {
    return opsFetch<{ results: Array<{ ticketId: string; ok: boolean; error?: string }> }>(
      "/ops/tickets/bulk-assign",
      undefined,
      { method: "POST", body: JSON.stringify({ ticketIds, techId }) },
    );
  },
  updateTicketStatus(
    id: string,
    body: { status?: string; locatorStatus?: string; notes?: string },
  ) {
    return opsFetch(`/ops/tickets/${id}/status`, undefined, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },
  exportTicketsCsv(params: QueryParams) {
    return opsFetchBlob("/ops/tickets/export.csv", params);
  },

  // Customers
  getCustomerSummary(range: QueryParams) {
    return opsFetch<{ range: RangeSummary; customers: CustomerSummaryRow[] }>(
      "/ops/customers/summary",
      range,
    );
  },

  // Canonical /me endpoints (v1.6 — scoped to authenticated user)
  getMyOverview() {
    return opsFetch<{
      techs: { totalTechs: number; clockedIn: number; enroute: number; onsite: number; paused: number; onLunch: number; onPersonal: number };
      tickets: { open: number; overdue: number; dueSoon: number; completedToday: number; totalFootageToday: number; highPriority: number };
      needsAttention: Array<{ type: string; id: string; label: string; detail: string }>;
      activeTechs: Array<any>;
      teamSummary: { totalWorkedMinutes: number; totalCompletedTickets: number; totalFootage: number; openBacklog: number };
    }>("/ops/me/overview");
  },
  getMyTechs(params?: { status?: string; limit?: number; offset?: number }) {
    return opsFetch<{ techs: Array<any> }>("/ops/me/techs", params);
  },
  getMyTeams() {
    return opsFetch<{ teams: Array<any> }>("/ops/me/teams");
  },
  getOpsMap(params?: { techId?: string; dueUrgency?: string; active?: boolean }) {
    return opsFetch<{
      markers: Array<{
        id: string; lat: number; lng: number; ticketNumber: string;
        dueUrgency?: string; locatorStatus: string; assignedTechName?: string; isActive: boolean;
      }>;
      center: { lat: number; lng: number };
    }>("/ops/map", params);
  },
};
