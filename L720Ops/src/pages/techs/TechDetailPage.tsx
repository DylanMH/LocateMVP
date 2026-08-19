import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { OpsService } from "../../services/opsService";
import { TerritoryService } from "../../services/territoryService";
import { TicketsService } from "../../services/ticketsService";
import { useRange } from "../../hooks/useRange";
import {
  DataTable,
  type DataTableColumn,
  Drawer,
  Metric,
  PageHeader,
  RangeToggle,
  Spinner,
  StatusBadge,
  formatDuration,
} from "../../components/ui";
import { AssignTechMenu } from "../../components/features/AssignTechMenu";
import { RescheduleModal } from "../../components/RescheduleModal";
import {
  ArrowLeftIcon,
  BanknotesIcon,
  ChartBarSquareIcon,
  CheckCircleIcon,
  ClockIcon,
  MapIcon,
} from "@heroicons/react/24/outline";
import type { TicketDetailResponse } from "../../types/ops";
import type { TerritoryNode } from "../../types";
import { formatTicketType } from "../../types/ticket";
import { getDueUrgencyBucket, getDueUrgencyTailwind, getDueUrgencyColor, DUE_URGENCY_LABELS, DUE_URGENCY_COLORS } from "../../utils/dueUrgency";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Rectangle, Tooltip, LayersControl, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const TYPE_LABELS: Record<string, string> = {
  NORMAL: "N",
  EMERGENCY: "E",
  DIGUP: "D",
  NON_COMPLIANT: "NC",
  UPDATE: "U",
  UPDATE_REMARK: "UR",
  RECALL: "R",
  NO_RESPONSE: "NR",
};

const ALLOCATION_LABELS: Record<string, string> = {
  locating: "Locating",
  training: "Training",
  truck_support: "Truck Support",
  meeting: "Meeting",
  oncall: "On Call",
  other: "Other",
};

const ALLOCATION_COLORS: Record<string, string> = {
  locating: "#10B981",
  training: "#3B82F6",
  truck_support: "#F59E0B",
  meeting: "#8B5CF6",
  oncall: "#EC4899",
  other: "#6B7280",
};

function allocationLabel(v: string | null | undefined): string {
  if (!v) return "Locating";
  return ALLOCATION_LABELS[v] || v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function allocationColor(v: string | null | undefined): string {
  if (!v) return ALLOCATION_COLORS.locating;
  return ALLOCATION_COLORS[v] || ALLOCATION_COLORS.other;
}

function makeTicketIcon(color: string, label: string) {
  return L.divIcon({
    className: "ticket-div-icon",
    html: `<div style="
      width: 22px; height: 22px; border-radius: 50%;
      background: ${color}; border: 2px solid #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 700; color: #fff;
      font-family: system-ui, sans-serif; line-height: 1;
    ">${label}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function makeTechLocationIcon(name: string) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return L.divIcon({
    className: "tech-live-div-icon",
    html: `<div style="
      width: 28px; height: 28px; border-radius: 50%;
      background: #10B981; border: 3px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 800; color: #fff;
      font-family: system-ui, sans-serif; line-height: 1;
    ">${initials}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function flattenTerritories(nodes: TerritoryNode[]): TerritoryNode[] {
  const flattened: TerritoryNode[] = [];
  const visit = (node: TerritoryNode) => {
    flattened.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return flattened;
}

function getBounds(territory: TerritoryNode): [[number, number], [number, number]] | null {
  if (
    territory.bboxSouth == null ||
    territory.bboxWest == null ||
    territory.bboxNorth == null ||
    territory.bboxEast == null
  ) {
    return null;
  }
  return [
    [territory.bboxSouth, territory.bboxWest],
    [territory.bboxNorth, territory.bboxEast],
  ];
}

// Parse ticket scope bounds from payloadJson (same logic as mobile app)
function getScopeBounds(payloadJson?: string): {
  latMin: number; latMax: number; lngMin: number; lngMax: number;
} | null {
  try {
    if (!payloadJson) return null;
    const payload = JSON.parse(payloadJson);
    const scope = payload?.scope;
    if (scope && typeof scope.latMin === "number" && typeof scope.latMax === "number" &&
        typeof scope.lngMin === "number" && typeof scope.lngMax === "number") {
      return scope;
    }
    return null;
  } catch {
    return null;
  }
}

function getAllocatedMinutesFromPayload(payloadJson?: string): number {
  try {
    if (!payloadJson) return 0;
    const payload = JSON.parse(payloadJson);
    const markings = payload?.customerMarkings || payload?.customerMarking || {};
    return Object.values(markings).reduce((sum: number, data: any) => {
      const mins = parseInt(data?.minutes || "0", 10);
      return sum + (isNaN(mins) ? 0 : mins);
    }, 0);
  } catch {
    return 0;
  }
}

function MapRefocus({ center }: { center: [number, number] | null }) {
  const map = useMap();
  const lastKey = useRef("");
  if (center) {
    const key = `${center[0].toFixed(3)},${center[1].toFixed(3)}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      map.flyTo(center, Math.max(map.getZoom(), 11), { duration: 0.8 });
    }
  }
  return null;
}

export function TechDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { state: range, setRange, toQuery, queryKey } = useRange("day");

  const techQuery = useQuery({
    queryKey: ["ops", "techs", "detail", id, queryKey],
    queryFn: () => OpsService.getTech(id, toQuery()),
    enabled: Boolean(id),
    refetchInterval: 30000,
  });

  const ticketsQuery = useQuery({
    queryKey: ["ops", "techs", "tickets", id, queryKey],
    queryFn: () => OpsService.getTechTickets(id, toQuery()),
    enabled: Boolean(id),
    refetchInterval: 30000,
  });

  const timesheetQuery = useQuery({
    queryKey: ["ops", "timesheet", id, queryKey],
    queryFn: () => OpsService.getTechTimesheet(id, toQuery()),
    enabled: Boolean(id),
    refetchInterval: 60000,
  });

  // Fetch territory tree to get the tech's assigned territory bboxes
  const treeQuery = useQuery({
    queryKey: ["ops", "territories", "tree", "tech-detail"],
    queryFn: () => TerritoryService.getTree(),
  });

  // Fetch boundary units for the tech's assigned territories
  const assignedTerritoryIds = useMemo(
    () => (techQuery.data?.assignedTerritories || []).map((t) => t.id),
    [techQuery.data?.assignedTerritories],
  );

  const boundaryUnitsQuery = useQuery({
    queryKey: ["tech-detail", "boundary-units", assignedTerritoryIds],
    queryFn: async () => {
      const results = await Promise.all(
        assignedTerritoryIds.map((tid) => TerritoryService.getTerritoryBoundaryUnits(tid)),
      );
      const map = new Map<string, Array<{ id: string; name: string; bbox: { north: number; south: number; east: number; west: number } }>>();
      results.forEach((result, index) => {
        map.set(
          assignedTerritoryIds[index],
          result.units.map((u) => ({ id: u.id, name: u.name, bbox: u.bbox })),
        );
      });
      return map;
    },
    enabled: assignedTerritoryIds.length > 0,
  });

  // Ticket detail drawer state
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["ops", "ticket-detail", selectedTicketId],
    queryFn: () => OpsService.getTicket(selectedTicketId!),
    enabled: Boolean(selectedTicketId),
  });

  const assignMutation = useMutation({
    mutationFn: ({ ticketId, techId }: { ticketId: string; techId: string | null }) =>
      OpsService.assignTicket(ticketId, techId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops", "tickets"] });
      qc.invalidateQueries({ queryKey: ["ops", "ticket-detail", selectedTicketId] });
      qc.invalidateQueries({ queryKey: ["ops", "techs", "tickets", id] });
    },
    onError: (err: Error) => {
      window.alert(`Reassignment failed: ${err.message}`);
    },
  });

  // live timer for current session
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Sub tab: "list" | "map"
  const [activeSubTab, setActiveSubTab] = useState<"list" | "map">("list");

  // Filters for tickets in range
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");

  const tech = techQuery.data;
  const rawTickets = ticketsQuery.data?.tickets || [];

  // Filtered tickets based on status & type
  const tickets = useMemo(() => {
    return rawTickets.filter((t) => {
      // Status filter
      if (statusFilter !== "ALL") {
        if (statusFilter === "OPEN") {
          if (t.locatorStatus === "CLOSED" || t.locatorStatus === "UNABLE") return false;
        } else if (statusFilter === "CLOSED") {
          if (t.locatorStatus !== "CLOSED" && t.locatorStatus !== "UNABLE") return false;
        } else if (statusFilter === "CLEARED") {
          // All customers marked as clear / not marked
          const payload = typeof t.payloadJson === "string" ? JSON.parse(t.payloadJson || "{}") : (t.payloadJson || {});
          const markings = payload.customerMarkings || payload.customerMarking || {};
          const markingList = Object.values(markings) as any[];
          if (markingList.length === 0) return false;
          const allCleared = markingList.every((m) => m.status === "NOT_MARKED" || m.result === "EXCAVATION_SITE_CLEAR");
          if (!allCleared) return false;
        } else if (statusFilter === "MARKED") {
          // At least one customer marked
          const payload = typeof t.payloadJson === "string" ? JSON.parse(t.payloadJson || "{}") : (t.payloadJson || {});
          const markings = payload.customerMarkings || payload.customerMarking || {};
          const markingList = Object.values(markings) as any[];
          const anyMarked = markingList.some((m) => m.status === "MARKED" || m.result === "PAINT_AND_FLAG" || m.result === "PAINT_ONLY" || m.result === "FLAG_ONLY");
          if (!anyMarked) return false;
        } else if (statusFilter === "RESCHEDULED") {
          // Placeholder for future rescheduling feature
          return false;
        } else if (t.locatorStatus !== statusFilter) {
          return false;
        }
      }

      // Type filter
      if (typeFilter !== "ALL" && t.ticketType !== typeFilter) {
        return false;
      }

      return true;
    });
  }, [rawTickets, statusFilter, typeFilter]);

  const ticketsWithCoords = tickets.filter((t) => t.lat != null && t.lng != null);

  // Tech GPS breadcrumbs / route query
  const routeQuery = useQuery({
    queryKey: ["ops", "tech-route", id],
    queryFn: () => OpsService.getTechRoute(id!),
    enabled: Boolean(id),
    refetchInterval: 15000,
  });

  const routePoints = routeQuery.data?.points || [];
  const latestLocation = routePoints.length > 0 ? routePoints[routePoints.length - 1] : null;
  const routeCoordinates = routePoints.map((p) => [p.latitude, p.longitude] as [number, number]);

  // Flatten territory tree for lookups
  const flattenedTerritories = useMemo(
    () => flattenTerritories(treeQuery.data?.tree || []),
    [treeQuery.data],
  );

  // Map center — based on tech's assigned territories or tickets
  const mapCenter = useMemo<[number, number]>(() => {
    // Try tickets first
    if (ticketsWithCoords.length > 0) {
      const lat = ticketsWithCoords.reduce((s, t) => s + t.lat, 0) / ticketsWithCoords.length;
      const lng = ticketsWithCoords.reduce((s, t) => s + t.lng, 0) / ticketsWithCoords.length;
      return [lat, lng];
    }
    // Try territory bboxes
    const territoryCenters: [number, number][] = [];
    for (const t of tech?.assignedTerritories || []) {
      const node = flattenedTerritories.find((n) => n.id === t.id);
      if (node?.centerLat != null && node?.centerLng != null) {
        territoryCenters.push([node.centerLat, node.centerLng]);
      }
    }
    // Try boundary unit centroids
    if (boundaryUnitsQuery.data) {
      for (const [, units] of boundaryUnitsQuery.data) {
        for (const u of units) {
          territoryCenters.push([
            (u.bbox.north + u.bbox.south) / 2,
            (u.bbox.east + u.bbox.west) / 2,
          ]);
        }
      }
    }
    if (territoryCenters.length > 0) {
      const lat = territoryCenters.reduce((s, c) => s + c[0], 0) / territoryCenters.length;
      const lng = territoryCenters.reduce((s, c) => s + c[1], 0) / territoryCenters.length;
      return [lat, lng];
    }
    return [32.7, -96.3];
  }, [ticketsWithCoords, tech?.assignedTerritories, flattenedTerritories, boundaryUnitsQuery.data]);

  // All boundary units for the tech's assigned territories (flattened)
  const allBoundaryUnits = useMemo(() => {
    if (!boundaryUnitsQuery.data) return [];
    const result: Array<{ id: string; name: string; bbox: { north: number; south: number; east: number; west: number }; territoryId: string }> = [];
    for (const [territoryId, units] of boundaryUnitsQuery.data) {
      for (const u of units) {
        result.push({ ...u, territoryId });
      }
    }
    return result;
  }, [boundaryUnitsQuery.data]);

  const ticketColumns: DataTableColumn<TicketDetailResponse>[] = [
    {
      key: "ticket",
      header: "Ticket",
      render: (t) => (
        <div>
          <div className="font-medium text-gray-900">{t.ticketNumber}</div>
          <div className="text-xs text-gray-500 truncate max-w-xs">
            {t.address}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (t) => <StatusBadge value={t.locatorStatus} />,
    },
    {
      key: "type",
      header: "Type",
      render: (t) => <StatusBadge value={t.ticketType} />,
    },
    {
      key: "time",
      header: "Time",
      align: "right",
      render: (t) => (
        <span className="tabular-nums">
          {formatDuration(t.timeAllocation?.totalMs ?? 0)}
        </span>
      ),
    },
    {
      key: "allocated",
      header: "Allocated",
      align: "right",
      render: (t) => {
        const mins = getAllocatedMinutesFromPayload(t.payloadJson);
        if (mins === 0) return <span className="text-gray-300">—</span>;
        return (
          <span className="tabular-nums font-medium text-gray-700">
            {mins}m
          </span>
        );
      },
    },
    {
      key: "due",
      header: "Due",
      render: (t) =>
        t.dueAt ? (
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: getDueUrgencyColor(t.dueAt) }}
            />
            <span className="text-xs text-gray-600">
              {new Date(t.dueAt).toLocaleDateString()}
            </span>
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${getDueUrgencyTailwind(t.dueAt)}`}>
              {DUE_URGENCY_LABELS[getDueUrgencyBucket(t.dueAt)]}
            </span>
          </div>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        ),
    },
    {
      key: "updated",
      header: "Updated",
      align: "right",
      render: (t) => (
        <span className="text-xs text-gray-500">
          {new Date(t.updatedAt).toLocaleString()}
        </span>
      ),
    },
  ];

  const detail = detailQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={tech?.name || "Loading…"}
        subtitle={
          <Link
            to="/techs"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to field employees
          </Link>
        }
        actions={<RangeToggle value={range} onChange={setRange} />}
      />

      {techQuery.isLoading || !tech ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Role
              </div>
              <div className="text-sm font-medium text-gray-900">
                {tech.role || "—"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Assigned Territories
              </div>
              <div className="text-sm font-medium text-gray-900">
                {tech.assignedTerritories && tech.assignedTerritories.length > 0
                  ? tech.assignedTerritories.map((t) => t.name).join(", ")
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Supervisor
              </div>
              <div className="text-sm font-medium text-gray-900">
                {tech.supervisorName || "—"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Clock
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge value={tech.clockStatus} />
                {tech.currentSession && tech.clockStatus === "CLOCKED_IN" && (
                  <span className="text-sm font-medium text-gray-900 tabular-nums">
                    {formatDuration(now - tech.currentSession.clockInAt)}
                  </span>
                )}
                {tech.currentSession && tech.clockStatus === "CLOCKED_OUT" && tech.currentSession.clockOutAt && (
                  <span className="text-sm font-medium text-gray-500 tabular-nums">
                    out {new Date(tech.currentSession.clockOutAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1" />
            {tech.currentTicket && (
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Current Ticket
                </div>
                <div className="font-medium text-gray-900">
                  {tech.currentTicket.ticketNumber}{" "}
                  <StatusBadge value={tech.currentTicket.locatorStatus} />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <Metric
              label="On Board"
              value={tech.productivity.ticketsOnBoard}
              icon={<ChartBarSquareIcon className="h-6 w-6" />}
            />
            <Metric
              label="Closed (range)"
              value={tech.productivity.ticketsClosedInRange}
              hint={`${tech.productivity.ticketsTotalClosed} all-time`}
              icon={<CheckCircleIcon className="h-6 w-6" />}
              accent="green"
            />
            <Metric
              label="Locates"
              value={tech.productivity.locatesClosed}
              icon={<BanknotesIcon className="h-6 w-6" />}
              accent="purple"
            />
            <Metric
              label="Footage"
              value={tech.productivity.footage.toLocaleString()}
              hint="feet"
              icon={<MapIcon className="h-6 w-6" />}
              accent="blue"
            />
            <Metric
              label="LPH · FPH"
              value={`${tech.productivity.lph.toFixed(1)} · ${Math.round(tech.productivity.fph)}`}
              icon={<ChartBarSquareIcon className="h-6 w-6" />}
            />
            <Metric
              label="Productive"
              value={formatDuration(tech.productivity.productiveMs)}
              hint={`lunch ${formatDuration(tech.productivity.lunchMs)} · personal ${formatDuration(tech.productivity.personalMs)}`}
              icon={<ClockIcon className="h-6 w-6" />}
              accent="yellow"
            />
          </div>

          {/* Sub-tab bar: Tickets in Range | Ticket Map + filters */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setActiveSubTab("list")}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeSubTab === "list"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Tickets in Range
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab("map")}
                className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-200 ${
                  activeSubTab === "map"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Ticket Map
              </button>
            </div>

            <div className="h-5 w-px bg-gray-200" />

            {/* Status filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">All</option>
                <option value="OPEN">Open</option>
                <option value="CLOSED">Closed</option>
                <option value="CLEARED">Cleared</option>
                <option value="MARKED">Marked</option>
                <option value="RESCHEDULED">Rescheduled</option>
              </select>
            </div>

            {/* Type filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Type:</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">All</option>
                <option value="NORMAL">Normal</option>
                <option value="EMERGENCY">Emergency</option>
                <option value="DIGUP">Digup</option>
                <option value="NON_COMPLIANT">Non-Compliant</option>
                <option value="UPDATE">Update</option>
                <option value="UPDATE_REMARK">Update Remark</option>
                <option value="RECALL">Recall</option>
                <option value="NO_RESPONSE">No Response</option>
              </select>
            </div>

            <div className="ml-auto text-xs text-gray-500">
              {tickets.length} of {rawTickets.length} tickets
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              {activeSubTab === "list" ? (
                <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Tickets in range
                    </h3>
                  </div>
                  <DataTable
                    columns={ticketColumns}
                    rows={tickets}
                    rowKey={(t) => t.id}
                    loading={ticketsQuery.isLoading}
                    onRowClick={(t) => setSelectedTicketId(t.id)}
                    empty={{ title: "No tickets match the selected filters" }}
                    className="border-none shadow-none rounded-none"
                    rowStyle={(t) =>
                      t.dueAt
                        ? { borderLeft: `4px solid ${getDueUrgencyColor(t.dueAt)}` }
                        : undefined
                    }
                  />
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">Ticket Map</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Territory boundaries with ticket markers and scope boxes
                      {statusFilter !== "ALL" || typeFilter !== "ALL" ? " (filtered)" : ""}
                    </p>
                  </div>
                  <div style={{ height: "500px" }}>
                    <MapContainer
                      center={mapCenter}
                      zoom={10}
                      scrollWheelZoom
                      style={{ height: "100%", width: "100%" }}
                    >
                      <MapRefocus center={mapCenter} />
                      <LayersControl position="topright">
                        <LayersControl.BaseLayer checked name="Street">
                          <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                          />
                        </LayersControl.BaseLayer>
                        <LayersControl.BaseLayer name="Satellite">
                          <TileLayer
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                            attribution="Tiles &copy; Esri"
                          />
                        </LayersControl.BaseLayer>
                      </LayersControl>

                      {/* Tech territory boundary rectangles */}
                      {(tech.assignedTerritories || []).map((at, idx) => {
                        const node = flattenedTerritories.find((n) => n.id === at.id);
                        if (!node) return null;
                        const bounds = getBounds(node);
                        if (!bounds) return null;
                        const color = ["#2563EB", "#0F766E", "#DC2626", "#7C3AED"][idx % 4];
                        return (
                          <Rectangle
                            key={at.id}
                            bounds={bounds}
                            pathOptions={{ color, weight: 2, fillOpacity: 0.08 }}
                          >
                            <Tooltip permanent direction="center" className="area-label">
                              <span style={{ fontWeight: 600, color, fontSize: "11px" }}>
                                {at.name}
                              </span>
                            </Tooltip>
                          </Rectangle>
                        );
                      })}

                      {/* Boundary unit city rectangles */}
                      {allBoundaryUnits.map((unit) => {
                        const bounds: [[number, number], [number, number]] = [
                          [unit.bbox.south, unit.bbox.west],
                          [unit.bbox.north, unit.bbox.east],
                        ];
                        return (
                          <Rectangle
                            key={`bu-${unit.territoryId}-${unit.id}`}
                            bounds={bounds}
                            pathOptions={{ color: "#2563EB", weight: 1.5, fillOpacity: 0.1 }}
                          >
                            <Tooltip direction="center" className="area-label">
                              <span style={{ fontSize: "9px", color: "#2563EB" }}>
                                {unit.name}
                              </span>
                            </Tooltip>
                          </Rectangle>
                        );
                      })}

                      {/* Ticket scope boxes (from payloadJson) */}
                      {ticketsWithCoords.map((ticket) => {
                        const scope = getScopeBounds(ticket.payloadJson);
                        if (!scope) return null;
                        const bounds: [[number, number], [number, number]] = [
                          [scope.latMin, scope.lngMin],
                          [scope.latMax, scope.lngMax],
                        ];
                        return (
                          <Rectangle
                            key={`scope-${ticket.id}`}
                            bounds={bounds}
                            pathOptions={{
                              color: "#F59E0B",
                              weight: 1,
                              fillOpacity: 0.1,
                              dashArray: "4 4",
                            }}
                          />
                        );
                      })}

                      {/* GPS Breadcrumb Route Trail */}
                      {routeCoordinates.length > 1 && (
                        <Polyline
                          positions={routeCoordinates}
                          pathOptions={{ color: "#10B981", weight: 3, opacity: 0.8, dashArray: "6 6" }}
                        />
                      )}

                      {/* Latest Tech GPS Location Marker (if clocked in / tracked) */}
                      {latestLocation && (
                        <Marker
                          position={[latestLocation.latitude, latestLocation.longitude]}
                          icon={makeTechLocationIcon(tech?.name || "Tech")}
                        >
                          <Tooltip direction="top" offset={[0, -14]} permanent={false}>
                            <div className="text-xs font-semibold">
                              <div>{tech?.name} (Current Location)</div>
                              <div className="text-gray-500 font-normal">
                                Updated {new Date(latestLocation.recordedAt).toLocaleTimeString()}
                              </div>
                            </div>
                          </Tooltip>
                        </Marker>
                      )}

                      {/* Ticket markers — colored by due urgency */}
                      {ticketsWithCoords.map((ticket) => {
                        const color = ticket.dueAt
                          ? getDueUrgencyColor(ticket.dueAt)
                          : DUE_URGENCY_COLORS.none;
                        const label = TYPE_LABELS[ticket.ticketType] || "?";
                        return (
                          <Marker
                            key={ticket.id}
                            position={[ticket.lat, ticket.lng]}
                            icon={makeTicketIcon(color, label)}
                            eventHandlers={{
                              click: () => setSelectedTicketId(ticket.id),
                            }}
                          >
                            <Tooltip direction="top" offset={[0, -12]}>
                              <div className="text-xs">
                                <div className="font-semibold">{ticket.ticketNumber}</div>
                                <div>{formatTicketType(ticket.ticketType)} · {ticket.locatorStatus}</div>
                                <div className="text-gray-500 truncate max-w-[200px]">{ticket.address}</div>
                                {ticket.dueAt && (
                                  <div className="mt-0.5">
                                    Due: {new Date(ticket.dueAt).toLocaleString()} · {DUE_URGENCY_LABELS[getDueUrgencyBucket(ticket.dueAt)]}
                                  </div>
                                )}
                              </div>
                            </Tooltip>
                          </Marker>
                        );
                      })}
                    </MapContainer>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Timesheet
                  </h3>
                  {tech.currentSession && tech.clockStatus === "CLOCKED_IN" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                        style={{
                          backgroundColor: allocationColor(tech.currentSession.allocationType),
                        }}
                      >
                        {allocationLabel(tech.currentSession.allocationType)} · Active
                      </span>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {formatDuration(tech.currentSession.allocationElapsedMs)}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        (since {new Date(tech.currentSession.allocationStartedAt ?? tech.currentSession.clockInAt).toLocaleTimeString()})
                      </span>
                    </div>
                  )}
                  {tech.currentSession && tech.clockStatus === "CLOCKED_OUT" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                        Clocked Out
                      </span>
                      {tech.currentSession.clockOutTicket && (
                        <span className="text-xs text-gray-500">
                          on {tech.currentSession.clockOutTicket.ticketNumber}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 tabular-nums">
                        {new Date(tech.currentSession.clockOutAt ?? 0).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                </div>
                <div className="px-5 py-3 space-y-3">
                  {timesheetQuery.data?.sessions.map((s) => {
                    const allocColor = allocationColor(s.allocationType);
                    const isActive = !s.clockOutAt;
                    return (
                      <div
                        key={s.id}
                        className="rounded-md border border-gray-100 p-3"
                        style={{ borderLeftWidth: "4px", borderLeftColor: allocColor }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-medium text-gray-900 text-sm">
                                {s.date}
                              </div>
                              {isActive && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {new Date(s.clockInAt).toLocaleTimeString()} →{" "}
                              {s.clockOutAt
                                ? new Date(s.clockOutAt).toLocaleTimeString()
                                : "active"}
                            </div>
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                                style={{ backgroundColor: allocColor }}
                              >
                                {allocationLabel(s.allocationType)}
                              </span>
                              {s.clockInReason && s.allocationType !== s.clockInReason && (
                                <span className="text-[10px] text-gray-500">
                                  {s.clockInReason.replace(/_/g, " ")}
                                </span>
                              )}
                              {s.otherReason && (
                                <span className="text-[10px] italic text-gray-400">
                                  {s.otherReason}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-semibold text-gray-900 tabular-nums">
                              {formatDuration(s.productiveMs)}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              L {formatDuration(s.lunchMs)} · P{" "}
                              {formatDuration(s.personalMs)}
                            </div>
                          </div>
                        </div>
                        {s.allocationBreakdown && s.allocationBreakdown.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                              Allocation Breakdown
                            </div>
                            {s.allocationBreakdown.map((alloc) => (
                              <div
                                key={alloc.type}
                                className="flex items-center justify-between text-[11px]"
                              >
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full"
                                    style={{ backgroundColor: allocationColor(alloc.type) }}
                                  />
                                  <span className="text-gray-700 font-medium">
                                    {allocationLabel(alloc.type)}
                                  </span>
                                  <span className="text-gray-400">
                                    ({alloc.segments.length} {alloc.segments.length === 1 ? "segment" : "segments"})
                                  </span>
                                </span>
                                <span className="tabular-nums font-semibold text-gray-900">
                                  {formatDuration(alloc.ms)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {s.breakSegments && s.breakSegments.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                            {s.breakSegments.map((b) => (
                              <div
                                key={b.id}
                                className="flex items-center justify-between text-[11px] text-gray-600"
                              >
                                <span>
                                  {b.type === "LUNCH" ? "🍽 Lunch" : "⏸ Personal"}
                                  {b.reason ? ` · ${b.reason.replace(/_/g, " ")}` : ""}
                                </span>
                                <span className="tabular-nums">
                                  {new Date(b.startedAt).toLocaleTimeString()} →{" "}
                                  {b.endedAt
                                    ? new Date(b.endedAt).toLocaleTimeString()
                                    : "active"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(!timesheetQuery.data ||
                    timesheetQuery.data.sessions.length === 0) && (
                    <div className="text-sm text-gray-500 text-center py-6">
                      No sessions in range.
                    </div>
                  )}
                </div>
                {timesheetQuery.data && (
                  <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-500 space-y-1">
                    <div>
                      Total productive{" "}
                      <span className="font-semibold text-gray-900">
                        {formatDuration(timesheetQuery.data.totals.productiveMs)}
                      </span>
                    </div>
                    <div>
                      Worked{" "}
                      <span className="font-semibold text-gray-700">
                        {formatDuration(timesheetQuery.data.totals.workedMs)}
                      </span>
                      {" · Lunch "}
                      <span className="font-semibold text-gray-700">
                        {formatDuration(timesheetQuery.data.totals.lunchMs)}
                      </span>
                      {" · Personal "}
                      <span className="font-semibold text-gray-700">
                        {formatDuration(timesheetQuery.data.totals.personalMs)}
                      </span>
                    </div>
                    {timesheetQuery.data.totals.allocationBreakdown &&
                      timesheetQuery.data.totals.allocationBreakdown.length > 0 && (
                        <div className="pt-2 mt-1 border-t border-gray-100 space-y-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Total by Allocation
                          </div>
                          {timesheetQuery.data.totals.allocationBreakdown.map((alloc) => (
                            <div key={alloc.type} className="flex items-center justify-between">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className="inline-block w-2 h-2 rounded-full"
                                  style={{ backgroundColor: allocationColor(alloc.type) }}
                                />
                                {allocationLabel(alloc.type)}
                              </span>
                              <span className="font-semibold text-gray-900 tabular-nums">
                                {formatDuration(alloc.ms)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Ticket detail drawer */}
      <Drawer
        open={Boolean(selectedTicketId)}
        onClose={() => setSelectedTicketId(null)}
        title={detail ? detail.ticketNumber : "Ticket"}
        subtitle={detail?.address}
        actions={
          detail && (
            <button
              onClick={() => setShowReschedule(true)}
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-sm px-3 py-2 rounded-md hover:bg-gray-50"
            >
              Reschedule
            </button>
          )
        }
      >
        {!detail ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase text-gray-500">Ticket Number</div>
                <div className="font-mono text-sm text-gray-900">{detail.ticketNumber}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Type</div>
                <StatusBadge value={detail.ticketType} label={formatTicketType(detail.ticketType)} />
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Status</div>
                <StatusBadge value={detail.locatorStatus} />
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Source</div>
                <div>{detail.source}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Created</div>
                <div>{new Date(detail.createdAt).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Due</div>
                <div className="flex items-center gap-2">
                  <span>{detail.dueAt ? new Date(detail.dueAt).toLocaleString() : "—"}</span>
                  {detail.dueAt && (
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getDueUrgencyTailwind(detail.dueAt)}`}>
                      {DUE_URGENCY_LABELS[getDueUrgencyBucket(detail.dueAt)]}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Closed</div>
                <div>{detail.closedAt ? new Date(detail.closedAt).toLocaleString() : "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Version</div>
                <div>{detail.version}</div>
              </div>
            </div>

            <div>
              <div className="text-xs uppercase text-gray-500 mb-1">Address</div>
              <div className="text-sm text-gray-900">{detail.address}</div>
              {detail.lat && detail.lng && (
                <div className="text-xs text-gray-500 mt-1">
                  {detail.lat.toFixed(6)}, {detail.lng.toFixed(6)}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs uppercase text-gray-500 mb-1">Assigned Tech</div>
              <AssignTechMenu
                value={detail.assignedTechId}
                onChange={(techId) => assignMutation.mutate({ ticketId: detail.id, techId })}
                disabled={detail.locatorStatus === "CLOSED" || detail.locatorStatus === "UNABLE"}
              />
              {(detail.locatorStatus === "CLOSED" || detail.locatorStatus === "UNABLE") && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-2">
                  Terminal tickets can't be reassigned. Reopen the ticket first if a tech needs to revisit it.
                </div>
              )}
            </div>

            {(() => {
              let p: any = {};
              try { p = JSON.parse(detail.payloadJson || "{}"); } catch { p = {}; }
              const scope = p.scope;
              return (
                <>
                  <div>
                    <div className="text-sm font-semibold text-gray-900 mb-2">Contractor & Work Details</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs uppercase text-gray-500">Work Type</div>
                        <div>{p.workType || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-gray-500">Contractor</div>
                        <div>{p.contractor || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-gray-500">Contractor Phone</div>
                        <div>{p.contractorPhone || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-gray-500">Contact Name</div>
                        <div>{p.contactName || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-gray-500">Contact Email</div>
                        <div>{p.contactEmail || "—"}</div>
                      </div>
                    </div>
                    {p.markingInstructions && (
                      <div className="mt-3">
                        <div className="text-xs uppercase text-gray-500">Marking Instructions</div>
                        <div className="text-sm text-gray-900 mt-1">{p.markingInstructions}</div>
                      </div>
                    )}
                  </div>

                  {scope && (
                    <div>
                      <div className="text-sm font-semibold text-gray-900 mb-2">Work Area Scope</div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs uppercase text-gray-500">Shape</div>
                          <div>{scope.shape || "—"}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase text-gray-500">Size</div>
                          <div>{scope.widthFeet != null && scope.heightFeet != null ? `${scope.widthFeet} ft × ${scope.heightFeet} ft` : "—"}</div>
                        </div>
                        <div className="col-span-2">
                          <div className="text-xs uppercase text-gray-500">Bounds (N, S, E, W)</div>
                          <div className="text-xs font-mono text-gray-900">
                            {scope.latMax != null ? `${scope.latMax.toFixed(6)}, ${scope.latMin?.toFixed(6)}, ${scope.lngMax?.toFixed(6)}, ${scope.lngMin?.toFixed(6)}` : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="text-sm font-semibold text-gray-900 mb-2">811 Lineage</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs uppercase text-gray-500">External Root #</div>
                        <div>{p.externalRootNumber || detail.externalTicketId || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-gray-500">Sequence #</div>
                        <div>{p.sequenceNumber ?? "—"}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-xs uppercase text-gray-500">Root Ticket ID</div>
                        <div className="text-xs font-mono text-gray-900">{p.rootTicketId || "—"}</div>
                      </div>
                      {p.parentTicketId && (
                        <div className="col-span-2">
                          <div className="text-xs uppercase text-gray-500">Parent Ticket ID</div>
                          <div className="text-xs font-mono text-gray-900">{p.parentTicketId}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}

            <div>
              <div className="text-sm font-semibold text-gray-900 mb-2">Time Allocation</div>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="bg-gray-50 rounded-md p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Enroute</div>
                  <div className="text-sm font-semibold text-gray-900 tabular-nums mt-1">{formatDuration(detail.timeAllocation.enrouteMs)}</div>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Onsite</div>
                  <div className="text-sm font-semibold text-gray-900 tabular-nums mt-1">{formatDuration(detail.timeAllocation.onsiteMs)}</div>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Paused</div>
                  <div className="text-sm font-semibold text-gray-900 tabular-nums mt-1">{formatDuration(detail.timeAllocation.pausedMs)}</div>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Total</div>
                  <div className="text-sm font-semibold text-gray-900 tabular-nums mt-1">{formatDuration(detail.timeAllocation.totalMs)}</div>
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-900 mb-2">Customers</div>
              {detail.customers.length === 0 ? (
                <div className="text-xs text-gray-500">No customer markings yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="py-2 pr-2">Customer</th>
                      <th className="py-2 pr-2">Utility</th>
                      <th className="py-2 pr-2">Status</th>
                      <th className="py-2 pr-2">Reason / Result</th>
                      <th className="py-2 pr-2 text-right">Min</th>
                      <th className="py-2 pr-2 text-right">Ft</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detail.customers.map((c) => (
                      <tr key={c.customerId}>
                        <td className="py-2 pr-2">{c.customerName || "—"}</td>
                        <td className="py-2 pr-2">{c.utilityType || "—"}</td>
                        <td className="py-2 pr-2"><StatusBadge value={c.status} /></td>
                        <td className="py-2 pr-2 text-gray-700 text-xs font-medium">
                          {c.result ? c.result.replace(/_/g, " ") : "—"}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{c.minutes}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{c.footage}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-900 mb-2">Notes ({detail.notes.length})</div>
              <div className="space-y-2">
                {detail.notes.map((n) => (
                  <div key={n.id} className="border border-gray-100 rounded-md p-3 text-sm">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>{n.author_name || "System"} · {n.note_type}</span>
                      <span>{new Date(n.created_at).toLocaleString()}</span>
                    </div>
                    <div className="text-gray-900 whitespace-pre-wrap">{n.body}</div>
                  </div>
                ))}
                {detail.notes.length === 0 && <div className="text-xs text-gray-500">No notes yet.</div>}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-900 mb-2">
                Reschedule History
              </div>
              <RescheduleHistoryPanel ticketId={detail.id} />
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-900 mb-2">History ({detail.events.length})</div>
              <ol className="divide-y divide-gray-100">
                {detail.events.slice().reverse().map((e) => (
                  <li key={e.id} className="py-2 text-sm">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{e.type}</span>
                      <span>{new Date(e.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-gray-800">
                      {e.oldLocatorStatus && e.newLocatorStatus && e.oldLocatorStatus !== e.newLocatorStatus
                        ? `${e.oldLocatorStatus} → ${e.newLocatorStatus}`
                        : e.notes || (e.oldLocatorStatus ? `Status: ${e.oldLocatorStatus}` : "—")}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Drawer>

      {detail && (
        <RescheduleModal
          isOpen={showReschedule}
          onClose={() => setShowReschedule(false)}
          ticketId={detail.id}
          ticketNumber={detail.ticketNumber}
          currentDueAt={detail.dueAt}
          address={detail.address}
          contractorName={(() => { try { return JSON.parse(detail.payloadJson || "{}").contractor; } catch { return undefined; } })()}
          contractorEmail={(() => { try { return JSON.parse(detail.payloadJson || "{}").contactEmail; } catch { return undefined; } })()}
          contractorPhone={(() => { try { return JSON.parse(detail.payloadJson || "{}").contractorPhone; } catch { return undefined; } })()}
        />
      )}
    </div>
  );
}

function RescheduleHistoryPanel({ ticketId }: { ticketId: string }) {
  const query = useQuery({
    queryKey: ["ops", "reschedule-history", ticketId],
    queryFn: () => TicketsService.getRescheduleHistory(ticketId),
    enabled: Boolean(ticketId),
  });

  if (query.isLoading) {
    return <div className="text-xs text-gray-500">Loading...</div>;
  }
  if (query.isError || !query.data) {
    return <div className="text-xs text-gray-500">Failed to load reschedule history.</div>;
  }
  if (query.data.length === 0) {
    return <div className="text-xs text-gray-500">No reschedules recorded.</div>;
  }

  return (
    <ol className="divide-y divide-gray-100">
      {query.data.map((r) => (
        <li key={r.id} className="py-3 text-sm space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span className="font-medium text-gray-700">
              Rescheduled · {r.source?.replace(/_/g, " ") || "Internal"}
            </span>
            <span>{new Date(r.created_at).toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-500">Previous Due: </span>
              <span className="text-gray-900">{new Date(r.previous_due_at).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">New Due: </span>
              <span className="text-gray-900">{new Date(r.new_due_at).toLocaleString()}</span>
            </div>
            {r.reason_code && (
              <div>
                <span className="text-gray-500">Reason: </span>
                <span className="text-gray-900">{r.reason_code.replace(/_/g, " ").toLowerCase()}</span>
              </div>
            )}
            {r.approval_name && (
              <div>
                <span className="text-gray-500">Approved By: </span>
                <span className="text-gray-900">{r.approval_name}</span>
              </div>
            )}
            {r.excavator_response && (
              <div>
                <span className="text-gray-500">Excavator Response: </span>
                <span className="text-gray-900">{r.excavator_response.replace(/_/g, " ").toLowerCase()}</span>
              </div>
            )}
            {r.eight_one_one_revision_state && r.eight_one_one_revision_state !== "N/A" && (
              <div>
                <span className="text-gray-500">811 Revision: </span>
                <span className="text-gray-900">{r.eight_one_one_revision_state}</span>
              </div>
            )}
          </div>
          {r.notes && (
            <div className="text-xs text-gray-700 whitespace-pre-wrap pt-1">{r.notes}</div>
          )}
        </li>
      ))}
    </ol>
  );
}
