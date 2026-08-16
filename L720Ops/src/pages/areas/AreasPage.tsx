import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Rectangle, Tooltip, LayersControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TerritoryService } from "../../services/territoryService";
import type { TerritoryDetails, TerritoryNode } from "../../types";

delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const PALETTE = ["#2563EB", "#0F766E", "#DC2626", "#7C3AED", "#D97706", "#0891B2", "#4F46E5"];

interface DisplayTerritory {
  territory: TerritoryNode;
  kind: "primary" | "child";
  groupId: string;
}

interface PersonFilterOption {
  id: string;
  label: string;
  role: "AREA_MANAGER" | "SUPERVISOR";
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

function withUniquePeople(territories: TerritoryNode[], type: "AREA" | "SUPERVISOR_TERRITORY"): PersonFilterOption[] {
  const options = new Map<string, PersonFilterOption>();
  territories
    .filter((territory) => territory.type === type)
    .forEach((territory) => {
      territory.owners?.forEach((owner) => {
        const role = type === "AREA" ? "AREA_MANAGER" : "SUPERVISOR";
        if (!options.has(owner.id)) {
          options.set(owner.id, { id: owner.id, label: owner.name, role });
        }
      });
    });
  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

interface BoundaryUnitInfo {
  id: string;
  name: string;
  bbox: { north: number; south: number; east: number; west: number };
}

export function AreasPage() {
  const [selectedPersonId, setSelectedPersonId] = useState("all-area-managers");
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null);

  const treeQuery = useQuery({
    queryKey: ["ops", "territories", "tree", "areas-page"],
    queryFn: () => TerritoryService.getTree(),
  });

  const territoryDetailsQuery = useQuery({
    queryKey: ["ops", "territories", selectedTerritoryId, "details"],
    queryFn: () => TerritoryService.get(selectedTerritoryId!),
    enabled: !!selectedTerritoryId,
  });

  const flattenedTerritories = useMemo(
    () => flattenTerritories(treeQuery.data?.tree || []),
    [treeQuery.data],
  );

  const territoryById = useMemo(
    () =>
      flattenedTerritories.reduce<Record<string, TerritoryNode>>((acc, territory) => {
        acc[territory.id] = territory;
        return acc;
      }, {}),
    [flattenedTerritories],
  );

  const areaTerritories = useMemo(
    () => flattenedTerritories.filter((territory) => territory.type === "AREA"),
    [flattenedTerritories],
  );
  const supervisorTerritories = useMemo(
    () => flattenedTerritories.filter((territory) => territory.type === "SUPERVISOR_TERRITORY"),
    [flattenedTerritories],
  );

  const peopleOptions = useMemo(
    () => [
      { id: "all-area-managers", label: "All Area Managers", role: "AREA_MANAGER" as const },
      ...withUniquePeople(areaTerritories, "AREA"),
      ...withUniquePeople(supervisorTerritories, "SUPERVISOR_TERRITORY"),
    ],
    [areaTerritories, supervisorTerritories],
  );

  const visibleTerritories = useMemo<DisplayTerritory[]>(() => {
    if (selectedPersonId === "all-area-managers") {
      return areaTerritories.map((territory) => ({
        territory,
        kind: "primary",
        groupId: territory.id,
      }));
    }

    const ownedSupervisorTerritories = supervisorTerritories.filter((territory) =>
      territory.owners?.some((owner) => owner.id === selectedPersonId),
    );

    if (ownedSupervisorTerritories.length > 0) {
      return ownedSupervisorTerritories.flatMap((territory) => [
        { territory, kind: "primary" as const, groupId: territory.id },
        ...territory.children
          .filter((child) => child.type === "TECH_TERRITORY")
          .map((child) => ({ territory: child, kind: "child" as const, groupId: territory.id })),
      ]);
    }

    const ownedAreaTerritories = areaTerritories.filter((territory) =>
      territory.owners?.some((owner) => owner.id === selectedPersonId),
    );

    return ownedAreaTerritories.flatMap((territory) => [
      { territory, kind: "primary" as const, groupId: territory.id },
      ...territory.children
        .filter((child) => child.type === "SUPERVISOR_TERRITORY")
        .map((child) => ({ territory: child, kind: "child" as const, groupId: territory.id })),
    ]);
  }, [areaTerritories, selectedPersonId, supervisorTerritories]);

  // Collect the IDs of visible supervisor territories so we can fetch their
  // individual boundary units (cities) and render each city as its own
  // rectangle instead of one giant aggregate bbox.
  const visibleSupervisorIds = useMemo(
    () =>
      visibleTerritories
        .filter((item) => item.territory.type === "SUPERVISOR_TERRITORY")
        .map((item) => item.territory.id),
    [visibleTerritories],
  );

  // Fetch boundary units for all visible supervisor territories. We use a
  // single query key that includes all the IDs so it re-fetches when the
  // set changes.
  const boundaryUnitsQuery = useQuery({
    queryKey: ["areas-page", "supervisor-boundary-units", visibleSupervisorIds],
    queryFn: async () => {
      const results = await Promise.all(
        visibleSupervisorIds.map((id) => TerritoryService.getTerritoryBoundaryUnits(id)),
      );
      const map = new Map<string, BoundaryUnitInfo[]>();
      results.forEach((result, index) => {
        map.set(
          visibleSupervisorIds[index],
          result.units.map((u) => ({
            id: u.id,
            name: u.name,
            bbox: u.bbox,
          })),
        );
      });
      return map;
    },
    enabled: visibleSupervisorIds.length > 0,
  });

  // Flatten all boundary units from all visible supervisor territories into
  // a single list for map rendering.
  const allVisibleBoundaryUnits = useMemo(() => {
    if (!boundaryUnitsQuery.data) return [];
    const result: Array<BoundaryUnitInfo & { groupId: string }> = [];
    for (const [supeId, units] of boundaryUnitsQuery.data) {
      for (const unit of units) {
        result.push({ ...unit, groupId: supeId });
      }
    }
    return result;
  }, [boundaryUnitsQuery.data]);

  const paletteByGroup = useMemo(
    () =>
      visibleTerritories.reduce<Record<string, string>>((acc, item, index) => {
        if (!acc[item.groupId]) {
          acc[item.groupId] = item.territory.color || PALETTE[index % PALETTE.length];
        }
        return acc;
      }, {}),
    [visibleTerritories],
  );

  const mapCenter = useMemo<[number, number]>(() => {
    const centers = visibleTerritories
      .filter((item) => item.territory.type !== "SUPERVISOR_TERRITORY")
      .map((item) => getCenter(item.territory))
      .filter((center): center is [number, number] => !!center);

    // Also include boundary unit centroids for supervisor territories
    for (const unit of allVisibleBoundaryUnits) {
      centers.push([
        (unit.bbox.north + unit.bbox.south) / 2,
        (unit.bbox.east + unit.bbox.west) / 2,
      ]);
    }

    if (centers.length === 0) {
      return [31.0, -99.0];
    }
    const avgLat = centers.reduce((sum, center) => sum + center[0], 0) / centers.length;
    const avgLng = centers.reduce((sum, center) => sum + center[1], 0) / centers.length;
    return [avgLat, avgLng];
  }, [visibleTerritories, allVisibleBoundaryUnits]);

  const selectedTerritory = selectedTerritoryId ? territoryById[selectedTerritoryId] : null;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Areas</h1>
          <p className="text-sm text-gray-600 mt-1">
            Territory-backed coverage view for area managers, supervisors, and sub areas.
          </p>
        </div>
        <div className="min-w-[320px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Filter by Person
          </label>
          <select
            value={selectedPersonId}
            onChange={(e) => {
              setSelectedPersonId(e.target.value);
              setSelectedTerritoryId(null);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            {peopleOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
                {option.role === "SUPERVISOR" ? " (Supervisor)" : option.id === "all-area-managers" ? "" : " (Area Manager)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          {treeQuery.isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">
              Loading territory map...
            </div>
          ) : (
            <MapContainer
              center={mapCenter}
              zoom={7}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
            >
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

              {visibleTerritories.map((item) => {
                // For supervisor territories, skip the aggregate bbox — we
                // render individual city boundary units below instead.
                if (item.territory.type === "SUPERVISOR_TERRITORY") return null;

                const bounds = getBounds(item.territory);
                if (!bounds) return null;
                const color = paletteByGroup[item.groupId];
                const isSelected = item.territory.id === selectedTerritoryId;
                return (
                  <Rectangle
                    key={item.territory.id}
                    bounds={bounds}
                    pathOptions={{
                      color,
                      weight: isSelected ? 4 : item.kind === "primary" ? 3 : 2,
                      fillOpacity: isSelected ? 0.28 : item.kind === "primary" ? 0.12 : 0.18,
                    }}
                    eventHandlers={{
                      click: () => setSelectedTerritoryId(item.territory.id),
                    }}
                  >
                    <Tooltip permanent direction="center" className="area-label">
                      <span style={{ fontWeight: 600, color }}>
                        {item.territory.name}
                      </span>
                    </Tooltip>
                  </Rectangle>
                );
              })}

              {/* Render individual city boundary units for supervisor
                  territories instead of one giant aggregate bbox. */}
              {allVisibleBoundaryUnits.map((unit) => {
                const color = paletteByGroup[unit.groupId] || "#2563EB";
                const bounds: [[number, number], [number, number]] = [
                  [unit.bbox.south, unit.bbox.west],
                  [unit.bbox.north, unit.bbox.east],
                ];
                return (
                  <Rectangle
                    key={`bu-${unit.id}`}
                    bounds={bounds}
                    pathOptions={{
                      color,
                      weight: 2,
                      fillOpacity: 0.15,
                    }}
                  >
                    <Tooltip direction="center" className="area-label">
                      <span style={{ fontSize: "10px", color }}>
                        {unit.name}
                      </span>
                    </Tooltip>
                  </Rectangle>
                );
              })}
            </MapContainer>
          )}
        </div>

        <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
          <AreasSidebar
            visibleTerritories={visibleTerritories}
            selectedTerritory={selectedTerritory}
            selectedDetails={territoryDetailsQuery.data}
            isLoading={territoryDetailsQuery.isLoading}
            onSelectTerritory={(territoryId) => setSelectedTerritoryId(territoryId)}
            onClearSelection={() => setSelectedTerritoryId(null)}
            colors={paletteByGroup}
            supervisorBoundaryUnits={boundaryUnitsQuery.data}
          />
        </div>
      </div>
    </div>
  );
}

function AreasSidebar({
  visibleTerritories,
  selectedTerritory,
  selectedDetails,
  isLoading,
  onSelectTerritory,
  onClearSelection,
  colors,
  supervisorBoundaryUnits,
}: {
  visibleTerritories: DisplayTerritory[];
  selectedTerritory: TerritoryNode | null;
  selectedDetails: TerritoryDetails | undefined;
  isLoading: boolean;
  onSelectTerritory: (territoryId: string) => void;
  onClearSelection: () => void;
  colors: Record<string, string>;
  supervisorBoundaryUnits?: Map<string, BoundaryUnitInfo[]>;
}) {
  if (!selectedTerritory) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Visible Coverage</h2>
        {visibleTerritories.length === 0 ? (
          <p className="text-sm text-gray-500">No territories match that filter yet.</p>
        ) : (
          <ul className="space-y-2">
            {visibleTerritories.map((item) => (
              <li key={item.territory.id}>
                <button
                  onClick={() => onSelectTerritory(item.territory.id)}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: colors[item.groupId] }}
                      />
                      <span className="font-medium text-gray-900">{item.territory.name}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {item.kind === "primary" ? item.territory.type.replace(/_/g, " ") : "Sub Area"}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const assignedTechs = selectedDetails?.assignments.filter((assignment) =>
    ["TECH", "TRAINER", "TRAINEE"].includes(assignment.role),
  ) || [];

  return (
    <div className="p-6 space-y-6">
      <button
        onClick={onClearSelection}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        Back to visible territories
      </button>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-4 h-4 rounded"
            style={{ backgroundColor: colors[selectedTerritory.id] || colors[selectedTerritory.parentTerritoryId || ""] || "#2563EB" }}
          />
          <h2 className="text-xl font-bold text-gray-900">{selectedTerritory.name}</h2>
        </div>
        <p className="text-xs text-gray-500">
          {selectedTerritory.type.replace(/_/g, " ")}
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading territory details...</div>
      ) : (
        <>
          <section>
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Owners
            </h3>
            {(selectedDetails?.assignments.filter((assignment) => assignment.assignmentType === "OWNER") || []).length === 0 ? (
              <p className="text-sm text-gray-500 italic">No owner assigned.</p>
            ) : (
              <ul className="space-y-2">
                {selectedDetails?.assignments
                  .filter((assignment) => assignment.assignmentType === "OWNER")
                  .map((assignment) => (
                    <li key={assignment.assignmentId} className="text-sm">
                      <div className="font-medium text-gray-900">{assignment.name}</div>
                      <div className="text-xs text-gray-500">{assignment.role}</div>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          {selectedTerritory.type === "TECH_TERRITORY" && (
            <section>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                Assigned Techs
              </h3>
              {assignedTechs.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No tech is assigned to this sub area.</p>
              ) : (
                <ul className="space-y-2">
                  {assignedTechs.map((assignment) => (
                    <li key={assignment.assignmentId} className="text-sm">
                      <div className="font-medium text-gray-900">{assignment.name}</div>
                      <div className="text-xs text-gray-500">
                        {assignment.role} · {assignment.assignmentType.replace(/_/g, " ")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {selectedTerritory.type === "SUPERVISOR_TERRITORY" && supervisorBoundaryUnits && (() => {
            const units = supervisorBoundaryUnits.get(selectedTerritory.id);
            if (!units || units.length === 0) return null;
            return (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                  Coverage Areas ({units.length})
                </h3>
                <div className="flex flex-wrap gap-1">
                  {units.map((unit) => (
                    <span
                      key={unit.id}
                      className="inline-flex px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200"
                    >
                      {unit.name}
                    </span>
                  ))}
                </div>
              </section>
            );
          })()}

          {selectedDetails && selectedDetails.children.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                Child Areas
              </h3>
              <ul className="space-y-2">
                {selectedDetails.children.map((child) => (
                  <li key={child.id}>
                    <button
                      onClick={() => onSelectTerritory(child.id)}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50"
                    >
                      <div className="font-medium text-gray-900">{child.name}</div>
                      <div className="text-xs text-gray-500">{child.type.replace(/_/g, " ")}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
