import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { OpsService } from "../../services/opsService";
import { TerritoryService } from "../../services/territoryService";
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
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Rectangle, Tooltip, LayersControl, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const STATUS_COLORS: Record<string, string> = {
  ASSIGNED: "#3B82F6",
  ENROUTE: "#F59E0B",
  ONSITE: "#10B981",
  PAUSED: "#8B5CF6",
  CLOSED: "#6B7280",
  UNABLE: "#EF4444",
};

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

function MapRefocus({ center }: { center: [number, number] | null }) {
  const map = useMap();
  const lastKey = "";
  if (center) {
    const key = `${center[0].toFixed(3)},${center[1].toFixed(3)}`;
    if (key !== lastKey) {
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

  const tech = techQuery.data;
  const tickets = ticketsQuery.data?.tickets || [];
  const ticketsWithCoords = tickets.filter((t) => t.lat != null && t.lng != null);

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
        title={tech?.name || "Technician"}
        subtitle={
          <Link
            to="/techs"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to technicians
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
                Sub Areas
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
                {tech.currentSession && (
                  <span className="text-sm font-medium text-gray-900 tabular-nums">
                    {formatDuration(now - tech.currentSession.clockInAt)}
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

          {/* Map view — tech territory boundaries + ticket markers + ticket scope */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Ticket Map</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Tech sub-area boundaries with ticket markers and scope boxes
              </p>
            </div>
            <div style={{ height: "400px" }}>
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

                {/* Ticket markers */}
                {ticketsWithCoords.map((ticket) => {
                  const color = STATUS_COLORS[ticket.locatorStatus] || "#6B7280";
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
                        </div>
                      </Tooltip>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
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
                  empty={{ title: "No tickets touched in this range" }}
                  className="border-none shadow-none rounded-none"
                />
              </div>
            </div>

            <div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Timesheet
                  </h3>
                </div>
                <div className="px-5 py-3 space-y-3">
                  {timesheetQuery.data?.sessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <div>
                        <div className="font-medium text-gray-900">
                          {s.date}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(s.clockInAt).toLocaleTimeString()} →{" "}
                          {s.clockOutAt
                            ? new Date(s.clockOutAt).toLocaleTimeString()
                            : "active"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900 tabular-nums">
                          {formatDuration(s.productiveMs)}
                        </div>
                        <div className="text-xs text-gray-500">
                          L {formatDuration(s.lunchMs)} · P{" "}
                          {formatDuration(s.personalMs)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!timesheetQuery.data ||
                    timesheetQuery.data.sessions.length === 0) && (
                    <div className="text-sm text-gray-500 text-center py-6">
                      No sessions in range.
                    </div>
                  )}
                </div>
                {timesheetQuery.data && (
                  <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-500">
                    Total productive{" "}
                    <span className="font-semibold text-gray-900">
                      {formatDuration(timesheetQuery.data.totals.productiveMs)}
                    </span>
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
      >
        {!detail ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase text-gray-500">Type</div>
                <StatusBadge value={detail.ticketType} label={formatTicketType(detail.ticketType)} />
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Status</div>
                <StatusBadge value={detail.locatorStatus} />
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Created</div>
                <div>{new Date(detail.createdAt).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Closed</div>
                <div>{detail.closedAt ? new Date(detail.closedAt).toLocaleString() : "—"}</div>
              </div>
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
              <div className="text-sm font-semibold text-gray-900 mb-2">History ({detail.events.length})</div>
              <ol className="divide-y divide-gray-100">
                {detail.events.slice().reverse().map((e) => (
                  <li key={e.id} className="py-2 text-sm">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{e.type}</span>
                      <span>{new Date(e.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-gray-800">
                      {e.oldLocatorStatus && e.newLocatorStatus
                        ? `${e.oldLocatorStatus} → ${e.newLocatorStatus}`
                        : e.notes || "—"}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
