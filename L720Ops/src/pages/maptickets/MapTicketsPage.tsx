import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, Rectangle, Tooltip, LayersControl, useMap, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { OpsService } from "../../services/opsService";
import { TerritoryService } from "../../services/territoryService";
import {
  DataTable,
  type DataTableColumn,
  Drawer,
  StatusBadge,
  formatDuration,
} from "../../components/ui";
import { AssignTechMenu } from "../../components/features/AssignTechMenu";
import type { TicketDetailResponse, TicketListRow } from "../../types/ops";
import type { TerritoryNode } from "../../types";
import { formatTicketType } from "../../types/ticket";
import { ArrowDownTrayIcon, MapIcon, TableCellsIcon } from "@heroicons/react/24/outline";

delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const PALETTE = ["#2563EB", "#0F766E", "#DC2626", "#7C3AED", "#D97706", "#0891B2", "#4F46E5"];

const LOCATOR_STATUSES = ["ASSIGNED", "ENROUTE", "ONSITE", "PAUSED", "CLOSED", "UNABLE"];
const TICKET_TYPES = ["NORMAL", "EMERGENCY", "DIGUP", "NON_COMPLIANT", "UPDATE", "UPDATE_REMARK", "RECALL", "NO_RESPONSE"];

// Ticket type → short label for map markers
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

// Status → marker color
const STATUS_COLORS: Record<string, string> = {
  ASSIGNED: "#3B82F6",
  ENROUTE: "#F59E0B",
  ONSITE: "#10B981",
  PAUSED: "#8B5CF6",
  CLOSED: "#6B7280",
  UNABLE: "#EF4444",
};

const TERRITORY_LEVELS = [
  { value: "", label: "All Territories" },
  { value: "AREA", label: "Area Manager Areas" },
  { value: "SUPERVISOR_TERRITORY", label: "Supervisor Areas" },
  { value: "TECH_TERRITORY", label: "Tech Sub Areas" },
];

interface BoundaryUnitInfo {
  id: string;
  name: string;
  bbox: { north: number; south: number; east: number; west: number };
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

function getCenter(territory: TerritoryNode): [number, number] | null {
  if (territory.centerLat != null && territory.centerLng != null) {
    return [territory.centerLat, territory.centerLng];
  }
  const bounds = getBounds(territory);
  if (!bounds) return null;
  return [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ];
}

// Create a Leaflet divIcon that renders a colored circle with the type label inside
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

// Helper to recenter the map when filters change
function MapRefocus({ center }: { center: [number, number] | null }) {
  const map = useMap();
  const lastCenter = useRef<string>("");
  if (center) {
    const key = `${center[0].toFixed(3)},${center[1].toFixed(3)}`;
    if (key !== lastCenter.current) {
      lastCenter.current = key;
      map.flyTo(center, Math.max(map.getZoom(), 9), { duration: 0.8 });
    }
  }
  return null;
}

export function MapTicketsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"map" | "table">("map");
  const [territoryLevel, setTerritoryLevel] = useState("");
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null);

  const filters = {
    search: params.get("search") || "",
    locatorStatus: params.get("locatorStatus") || "",
    ticketType: params.get("ticketType") || "",
    unassigned: params.get("unassigned") === "true",
    page: parseInt(params.get("page") || "1", 10),
  };

  const setFilter = (key: string, value: string | number | boolean | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "" || value === false) next.delete(key);
    else next.set(key, String(value));
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  // Fetch territory tree
  const treeQuery = useQuery({
    queryKey: ["ops", "territories", "tree", "map-tickets"],
    queryFn: () => TerritoryService.getTree(),
  });

  const flattenedTerritories = useMemo(
    () => flattenTerritories(treeQuery.data?.tree || []),
    [treeQuery.data],
  );

  // Filter territories by selected level
  const levelTerritories = useMemo(() => {
    if (!territoryLevel) return flattenedTerritories;
    return flattenedTerritories.filter((t) => t.type === territoryLevel);
  }, [flattenedTerritories, territoryLevel]);

  // Fetch tickets (with optional territory filter)
  const listQuery = useQuery({
    queryKey: ["ops", "tickets", "list", filters, selectedTerritoryId],
    queryFn: () =>
      OpsService.getTickets({
        search: filters.search || undefined,
        locatorStatus: filters.locatorStatus || undefined,
        ticketType: filters.ticketType || undefined,
        unassigned: filters.unassigned ? "true" : undefined,
        territoryId: selectedTerritoryId || undefined,
        page: filters.page,
        limit: 500,
      }),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const detailQuery = useQuery({
    queryKey: ["ops", "ticket-detail", selectedId],
    queryFn: () => OpsService.getTicket(selectedId!),
    enabled: Boolean(selectedId),
  });

  const assignMutation = useMutation({
    mutationFn: ({ ticketId, techId }: { ticketId: string; techId: string | null }) =>
      OpsService.assignTicket(ticketId, techId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops", "tickets"] });
      qc.invalidateQueries({ queryKey: ["ops", "ticket-detail", selectedId] });
    },
    onError: (err: Error) => {
      window.alert(`Reassignment failed: ${err.message}`);
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: ({ ticketIds, techId }: { ticketIds: string[]; techId: string | null }) =>
      OpsService.bulkAssign(ticketIds, techId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ops", "tickets"] });
      const failed = data.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        window.alert(
          `${data.results.length - failed.length} assigned, ${failed.length} skipped:\n\n` +
            failed.map((r) => `- ${r.ticketId.slice(0, 8)}: ${r.error}`).join("\n"),
        );
      }
      setSelected(new Set());
    },
    onError: (err: Error) => {
      window.alert(`Bulk assign failed: ${err.message}`);
    },
  });

  const handleExport = async () => {
    const blob = await OpsService.exportTicketsCsv({
      search: filters.search || undefined,
      locatorStatus: filters.locatorStatus || undefined,
      ticketType: filters.ticketType || undefined,
      unassigned: filters.unassigned ? "true" : undefined,
      territoryId: selectedTerritoryId || undefined,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Fetch boundary units for all supervisor AND tech territories so we can
  // render individual city rectangles at both levels.
  const visibleBoundaryTerritoryIds = useMemo(() => {
    return flattenedTerritories
      .filter((t) => t.type === "SUPERVISOR_TERRITORY" || t.type === "TECH_TERRITORY")
      .map((t) => t.id);
  }, [flattenedTerritories]);

  const boundaryUnitsQuery = useQuery({
    queryKey: ["map-tickets", "boundary-units", visibleBoundaryTerritoryIds],
    queryFn: async () => {
      const results = await Promise.all(
        visibleBoundaryTerritoryIds.map((id) => TerritoryService.getTerritoryBoundaryUnits(id)),
      );
      const map = new Map<string, BoundaryUnitInfo[]>();
      results.forEach((result, index) => {
        map.set(
          visibleBoundaryTerritoryIds[index],
          result.units.map((u) => ({ id: u.id, name: u.name, bbox: u.bbox })),
        );
      });
      return map;
    },
    enabled: visibleBoundaryTerritoryIds.length > 0,
  });

  // Map of territory ID → territory type for quick lookups
  const territoryTypeById = useMemo(() => {
    const map = new Map<string, string>();
    flattenedTerritories.forEach((t) => map.set(t.id, t.type));
    return map;
  }, [flattenedTerritories]);

  // All boundary units flattened, tagged with their parent territory ID.
  // Filtered by the selected territory level so we only show relevant
  // boundaries on the map.
  const allBoundaryUnits = useMemo(() => {
    if (!boundaryUnitsQuery.data) return [];
    const result: Array<BoundaryUnitInfo & { territoryId: string }> = [];
    for (const [territoryId, units] of boundaryUnitsQuery.data) {
      const type = territoryTypeById.get(territoryId);
      // If a level is selected, only include boundary units for territories
      // of that type. If no level is selected, show supervisor cities only
      // (tech sub-areas would overlap with their parent supervisor cities).
      if (territoryLevel) {
        if (type !== territoryLevel) continue;
      } else {
        if (type !== "SUPERVISOR_TERRITORY") continue;
      }
      for (const unit of units) {
        result.push({ ...unit, territoryId });
      }
    }
    return result;
  }, [boundaryUnitsQuery.data, territoryLevel, territoryTypeById]);

  // Color palette for territory groups
  const paletteByGroup = useMemo(() => {
    const groups = new Set<string>();
    levelTerritories.forEach((t) => groups.add(t.id));
    const arr = Array.from(groups);
    const map: Record<string, string> = {};
    arr.forEach((id, i) => {
      map[id] = PALETTE[i % PALETTE.length];
    });
    return map;
  }, [levelTerritories]);

  // Map center — based on selected territory or all tickets
  const mapCenter = useMemo<[number, number] | null>(() => {
    if (selectedTerritoryId) {
      const t = flattenedTerritories.find((x) => x.id === selectedTerritoryId);
      if (t) {
        const c = getCenter(t);
        if (c) return c;
        // Try boundary units for this territory
        const units = boundaryUnitsQuery.data?.get(t.id);
        if (units && units.length > 0) {
          const lat = units.reduce((s, u) => s + (u.bbox.north + u.bbox.south) / 2, 0) / units.length;
          const lng = units.reduce((s, u) => s + (u.bbox.east + u.bbox.west) / 2, 0) / units.length;
          return [lat, lng];
        }
      }
    }
    // Center on tickets if available
    const tickets = listQuery.data?.tickets || [];
    const withCoords = tickets.filter((t) => t.lat != null && t.lng != null);
    if (withCoords.length > 0) {
      const lat = withCoords.reduce((s, t) => s + t.lat, 0) / withCoords.length;
      const lng = withCoords.reduce((s, t) => s + t.lng, 0) / withCoords.length;
      return [lat, lng];
    }
    // Default to ETX area
    return [32.7, -96.3];
  }, [selectedTerritoryId, flattenedTerritories, boundaryUnitsQuery.data, listQuery.data]);

  const tickets = listQuery.data?.tickets || [];
  const ticketsWithCoords = tickets.filter((t) => t.lat != null && t.lng != null);

  // Table columns (reused from TicketsPage)
  const columns = useMemo<DataTableColumn<TicketListRow>[]>(
    () => [
      {
        key: "sel",
        header: (
          <input
            type="checkbox"
            checked={Boolean(tickets.length) && tickets.every((t) => selected.has(t.id))}
            onChange={(e) => {
              const all = tickets.map((t) => t.id);
              setSelected(e.target.checked ? new Set(all) : new Set());
            }}
          />
        ),
        render: (t) => (
          <input
            type="checkbox"
            checked={selected.has(t.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(t.id);
              else next.delete(t.id);
              setSelected(next);
            }}
          />
        ),
      },
      {
        key: "number",
        header: "Ticket",
        render: (t) => (
          <div>
            <div className="font-medium text-gray-900">{t.ticketNumber}</div>
            <div className="text-xs text-gray-500 truncate max-w-xs">{t.address}</div>
          </div>
        ),
      },
      { key: "type", header: "Type", render: (t) => <StatusBadge value={t.ticketType} label={formatTicketType(t.ticketType)} /> },
      { key: "status", header: "Status", render: (t) => <StatusBadge value={t.locatorStatus} /> },
      {
        key: "tech",
        header: "Tech",
        render: (t) =>
          t.assignedTech ? (
            <div>
              <div className="text-sm text-gray-900">{t.assignedTech.name}</div>
            </div>
          ) : (
            <span className="text-xs text-yellow-700 font-medium">Unassigned</span>
          ),
      },
      {
        key: "updated",
        header: "Updated",
        align: "right",
        render: (t) => (
          <span className="text-xs text-gray-500">{new Date(t.updatedAt).toLocaleString()}</span>
        ),
      },
    ],
    [tickets, selected],
  );

  const detail = detailQuery.data;
  const [bulkTechId, setBulkTechId] = useState<string | null>(null);

  // Territory dropdown options based on selected level
  const territoryOptions = useMemo(() => {
    return levelTerritories.map((t) => ({ id: t.id, name: t.name, type: t.type }));
  }, [levelTerritories]);

  // Ticket type counts from the currently loaded tickets
  const ticketTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      counts[t.ticketType] = (counts[t.ticketType] || 0) + 1;
    }
    return counts;
  }, [tickets]);

  const selectedTerritory = selectedTerritoryId
    ? flattenedTerritories.find((t) => t.id === selectedTerritoryId) || null
    : null;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header with filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Map View</h1>
            <p className="text-sm text-gray-600">
              {listQuery.data ? `${listQuery.data.pagination.total.toLocaleString()} tickets` : "Loading…"}
              {selectedTerritory && ` · ${selectedTerritory.name}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
              <button
                onClick={() => setViewMode("map")}
                className={`px-3 py-2 text-sm flex items-center gap-1.5 ${
                  viewMode === "map" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <MapIcon className="h-4 w-4" />
                Map
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`px-3 py-2 text-sm flex items-center gap-1.5 ${
                  viewMode === "table" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <TableCellsIcon className="h-4 w-4" />
                Table
              </button>
            </div>
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-sm px-3 py-2 rounded-md hover:bg-gray-50"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3">
          <input
            type="search"
            placeholder="Search ticket # or address"
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <select
            value={territoryLevel}
            onChange={(e) => {
              setTerritoryLevel(e.target.value);
              setSelectedTerritoryId(null);
            }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            {TERRITORY_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <select
            value={selectedTerritoryId || ""}
            onChange={(e) => setSelectedTerritoryId(e.target.value || null)}
            className="min-w-[180px] max-w-[260px] px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All {territoryLevel ? territoryLevel.replace(/_/g, " ").toLowerCase() : "territories"}</option>
            {territoryOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={filters.locatorStatus}
            onChange={(e) => setFilter("locatorStatus", e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All Statuses</option>
            {LOCATOR_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={filters.ticketType}
            onChange={(e) => setFilter("ticketType", e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All Types</option>
            {TICKET_TYPES.map((s) => (
              <option key={s} value={s}>{formatTicketType(s)}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={filters.unassigned}
              onChange={(e) => setFilter("unassigned", e.target.checked)}
            />
            Unassigned only
          </label>
        </div>

        {/* Bulk assign bar */}
        {selected.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-md px-4 py-2 flex items-center gap-3">
            <div className="text-sm text-blue-900 font-medium">
              {selected.size} ticket{selected.size === 1 ? "" : "s"} selected
            </div>
            <div className="flex-1" />
            <div className="w-64">
              <AssignTechMenu
                value={bulkTechId}
                onChange={setBulkTechId}
                placeholder="Select technician…"
              />
            </div>
            <button
              disabled={!bulkTechId || bulkAssignMutation.isPending}
              onClick={() =>
                bulkAssignMutation.mutate({
                  ticketIds: Array.from(selected),
                  techId: bulkTechId,
                })
              }
              className="bg-blue-600 text-white text-sm px-3 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {bulkAssignMutation.isPending ? "Assigning…" : "Assign"}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Clear
            </button>
          </div>
        )}

        {/* Ticket type summary card */}
        <div className="flex flex-wrap gap-2">
          {TICKET_TYPES.map((type) => {
            const count = ticketTypeCounts[type] || 0;
            const label = TYPE_LABELS[type] || "?";
            const color = STATUS_COLORS["ASSIGNED"]; // use a neutral accent
            return (
              <div
                key={type}
                className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5"
              >
                <span
                  className="flex items-center justify-center rounded-full text-white font-bold"
                  style={{
                    width: 22,
                    height: 22,
                    fontSize: 9,
                    backgroundColor: color,
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  {label}
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="text-xs text-gray-500">{formatTicketType(type)}</span>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">{count}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {viewMode === "map" ? (
          <>
            {/* Map */}
            <div className="flex-1 relative">
              {treeQuery.isLoading ? (
                <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                  Loading map…
                </div>
              ) : (
                <MapContainer
                  center={mapCenter || [32.7, -96.3]}
                  zoom={8}
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

                  {/* Territory boundaries — render rectangles for AREA and
                      TECH_TERRITORY types that have bboxes. Supervisor
                      territories are rendered via their individual city
                      boundary units below. */}
                  {levelTerritories.map((territory) => {
                    if (territory.type === "SUPERVISOR_TERRITORY") return null;

                    const bounds = getBounds(territory);
                    if (!bounds) return null;
                    const color = paletteByGroup[territory.id] || "#2563EB";
                    const isSelected = territory.id === selectedTerritoryId;
                    return (
                      <Rectangle
                        key={territory.id}
                        bounds={bounds}
                        pathOptions={{
                          color,
                          weight: isSelected ? 4 : 2,
                          fillOpacity: isSelected ? 0.25 : 0.08,
                        }}
                        eventHandlers={{
                          click: () => setSelectedTerritoryId(territory.id),
                        }}
                      >
                        <Tooltip permanent direction="center" className="area-label">
                          <span style={{ fontWeight: 600, color, fontSize: "11px" }}>
                            {territory.name}
                          </span>
                        </Tooltip>
                      </Rectangle>
                    );
                  })}

                  {/* Boundary unit rectangles for supervisor AND tech
                      territories. Each city rectangle is clickable and
                      selects the territory it belongs to. */}
                  {allBoundaryUnits.map((unit) => {
                    const color = paletteByGroup[unit.territoryId] || "#2563EB";
                    const isSelected = unit.territoryId === selectedTerritoryId;
                    const bounds: [[number, number], [number, number]] = [
                      [unit.bbox.south, unit.bbox.west],
                      [unit.bbox.north, unit.bbox.east],
                    ];
                    return (
                      <Rectangle
                        key={`bu-${unit.territoryId}-${unit.id}`}
                        bounds={bounds}
                        pathOptions={{
                          color,
                          weight: isSelected ? 3 : 1.5,
                          fillOpacity: isSelected ? 0.2 : 0.1,
                        }}
                        eventHandlers={{
                          click: () => setSelectedTerritoryId(unit.territoryId),
                        }}
                      >
                        <Tooltip direction="center" className="area-label">
                          <span style={{ fontSize: "9px", color }}>
                            {unit.name}
                          </span>
                        </Tooltip>
                      </Rectangle>
                    );
                  })}

                  {/* Ticket markers — divIcon with colored circle + type label */}
                  {ticketsWithCoords.map((ticket) => {
                    const color = STATUS_COLORS[ticket.locatorStatus] || "#6B7280";
                    const label = TYPE_LABELS[ticket.ticketType] || "?";
                    return (
                      <Marker
                        key={ticket.id}
                        position={[ticket.lat, ticket.lng]}
                        icon={makeTicketIcon(color, label)}
                        eventHandlers={{
                          click: () => setSelectedId(ticket.id),
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
              )}
            </div>

            {/* Sidebar — territory info + ticket list */}
            <div className="w-80 border-l border-gray-200 bg-white overflow-y-auto flex flex-col">
              {selectedTerritory ? (
                <TerritoryInfoPanel
                  territory={selectedTerritory}
                  tickets={tickets}
                  onClearSelection={() => setSelectedTerritoryId(null)}
                  onTicketClick={(id) => setSelectedId(id)}
                />
              ) : (
                <div className="p-4 flex-1 overflow-y-auto">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                    {territoryLevel ? territoryLevel.replace(/_/g, " ") + "s" : "Territories"}
                  </h3>
                  {levelTerritories.length === 0 ? (
                    <p className="text-sm text-gray-500">No territories found.</p>
                  ) : (
                    <ul className="space-y-1">
                      {levelTerritories.map((t) => (
                        <li key={t.id}>
                          <button
                            onClick={() => setSelectedTerritoryId(t.id)}
                            className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 flex items-center gap-2"
                          >
                            <span
                              className="w-3 h-3 rounded flex-shrink-0"
                              style={{ backgroundColor: paletteByGroup[t.id] || "#2563EB" }}
                            />
                            <span className="text-sm font-medium text-gray-900 truncate">{t.name}</span>
                            <span className="text-xs text-gray-400 ml-auto">
                              {t.type.replace(/_/g, " ")}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Legend */}
                  <div className="mt-6 pt-4 border-t border-gray-100">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Status Colors</h4>
                    <div className="grid grid-cols-2 gap-1.5">
                      {Object.entries(STATUS_COLORS).map(([status, color]) => (
                        <div key={status} className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-xs text-gray-600">{status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Type Labels</h4>
                    <div className="grid grid-cols-3 gap-1.5">
                      {Object.entries(TYPE_LABELS).map(([type, label]) => (
                        <div key={type} className="flex items-center gap-1">
                          <span className="text-xs font-bold text-gray-700 w-6">{label}</span>
                          <span className="text-xs text-gray-500 truncate">{formatTicketType(type)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Table view */
          <div className="flex-1 overflow-auto p-6">
            <DataTable
              columns={columns}
              rows={tickets}
              rowKey={(t) => t.id}
              loading={listQuery.isLoading}
              onRowClick={(t) => setSelectedId(t.id)}
              empty={{ title: "No tickets match your filters" }}
            />
            {listQuery.data && listQuery.data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-gray-600 mt-4">
                <div>
                  Page {listQuery.data.pagination.page} of {listQuery.data.pagination.totalPages}
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={filters.page <= 1}
                    onClick={() => setFilter("page", Math.max(1, filters.page - 1))}
                    className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <button
                    disabled={filters.page >= listQuery.data.pagination.totalPages}
                    onClick={() => setFilter("page", filters.page + 1)}
                    className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ticket detail drawer */}
      <Drawer
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={detail ? detail.ticketNumber : "Ticket"}
        subtitle={detail?.address}
      >
        {!detail ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
          <TicketDetailBody
            detail={detail}
            onAssign={(techId) => assignMutation.mutate({ ticketId: detail.id, techId })}
          />
        )}
      </Drawer>
    </div>
  );
}

// Territory info sidebar panel
function TerritoryInfoPanel({
  territory,
  tickets,
  onClearSelection,
  onTicketClick,
}: {
  territory: TerritoryNode;
  tickets: TicketListRow[];
  onClearSelection: () => void;
  onTicketClick: (id: string) => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <button
        onClick={onClearSelection}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        ← Back to list
      </button>

      <div>
        <h2 className="text-lg font-bold text-gray-900">{territory.name}</h2>
        <p className="text-xs text-gray-500">{territory.type.replace(/_/g, " ")}</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
          Tickets ({tickets.length})
        </h3>
        {tickets.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No tickets in this territory.</p>
        ) : (
          <ul className="space-y-1 max-h-[calc(100vh-20rem)] overflow-y-auto">
            {tickets.slice(0, 100).map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onTicketClick(t.id)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: STATUS_COLORS[t.locatorStatus] || "#6B7280" }}
                    />
                    <span className="text-sm font-medium text-gray-900">{t.ticketNumber}</span>
                    <span className="text-xs text-gray-400 ml-auto">{TYPE_LABELS[t.ticketType] || "?"}</span>
                  </div>
                  <div className="text-xs text-gray-500 truncate pl-4">{t.address}</div>
                </button>
              </li>
            ))}
            {tickets.length > 100 && (
              <li className="text-xs text-gray-400 text-center py-2">
                Showing 100 of {tickets.length}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

// Ticket detail body (reused from TicketsPage)
function TicketDetailBody({
  detail,
  onAssign,
}: {
  detail: TicketDetailResponse;
  onAssign: (techId: string | null) => void;
}) {
  return (
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
          onChange={onAssign}
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
          <TimeBox label="Enroute" ms={detail.timeAllocation.enrouteMs} />
          <TimeBox label="Onsite" ms={detail.timeAllocation.onsiteMs} />
          <TimeBox label="Paused" ms={detail.timeAllocation.pausedMs} />
          <TimeBox label="Total" ms={detail.timeAllocation.totalMs} />
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
  );
}

function TimeBox({ label, ms }: { label: string; ms: number }) {
  return (
    <div className="bg-gray-50 rounded-md p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 tabular-nums mt-1">{formatDuration(ms)}</div>
    </div>
  );
}
