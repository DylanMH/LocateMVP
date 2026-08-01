import { useEffect, useState, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Rectangle, CircleMarker, useMap, useMapEvents, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLngBounds } from "leaflet";

// Texas center roughly
const TX_CENTER: [number, number] = [31.0, -99.0];

/** Boundary unit from backend */
export interface BoundaryUnit {
  id: string;
  sourceId: string;
  name: string;
  type: string;
  centroid: { lat: number; lng: number };
  bbox: { north: number; south: number; east: number; west: number };
  landArea?: number;
  waterArea?: number;
}

interface TerritoryMapProps {
  // Parent territory to show as shaded background context
  parentBbox?: { north: number; south: number; east: number; west: number } | null;
  
  // Available boundary units for selection (from backend)
  boundaryUnits?: BoundaryUnit[];
  
  // Currently selected unit IDs
  selectedUnitIds?: string[];

  // Boundary units already claimed by sibling territories; visible but not selectable.
  disabledUnitIds?: string[];

  // Optional labels for disabled units, keyed by unit ID.
  disabledUnitLabels?: Record<string, string>;
  
  // Toggle callback - receives the unit ID
  onToggleUnit?: (unitId: string) => void;
  
  // View mode - highlight a specific bbox
  highlightBbox?: { north: number; south: number; east: number; west: number } | null;
  
  height?: string;
  
  // Show actual bounding boxes instead of just centroid markers
  showBoundingBoxes?: boolean;

  // Legacy prop accepted for compatibility with callers; marker sizing is fixed for now.
  sizeByArea?: boolean;

  // Enable drag-to-select rectangle mode.
  enableBoxSelect?: boolean;

  // Called with all boundary unit IDs intersecting the drawn box.
  onBoxSelect?: (unitIds: string[]) => void;
}

interface SelectionBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

function normalizeSelectionBox(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): SelectionBox {
  return {
    north: Math.max(start.lat, end.lat),
    south: Math.min(start.lat, end.lat),
    east: Math.max(start.lng, end.lng),
    west: Math.min(start.lng, end.lng),
  };
}

function selectionBoxToBounds(box: SelectionBox): [[number, number], [number, number]] {
  return [
    [box.south, box.west],
    [box.north, box.east],
  ];
}

function centroidWithinSelection(
  centroid: BoundaryUnit["centroid"],
  box: SelectionBox,
): boolean {
  return (
    centroid.lat >= box.south &&
    centroid.lat <= box.north &&
    centroid.lng >= box.west &&
    centroid.lng <= box.east
  );
}

function bboxIntersectsSelection(
  bbox: BoundaryUnit["bbox"],
  box: SelectionBox,
): boolean {
  return !(
    bbox.west > box.east ||
    bbox.east < box.west ||
    bbox.south > box.north ||
    bbox.north < box.south
  );
}

// Fit map to bounds only once on initial load
function InitialBoundsFitter({ bounds }: { bounds: LatLngBounds | null }) {
  const map = useMap();
  const hasFitted = useRef(false);
  useEffect(() => {
    if (bounds && !hasFitted.current) {
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 10 });
      hasFitted.current = true;
    }
  }, [bounds, map]);
  return null;
}

function BoxSelectController({
  enabled,
  boundaryUnits,
  disabledUnitIds,
  onBoxSelect,
  onPreviewChange,
}: {
  enabled: boolean;
  boundaryUnits: BoundaryUnit[];
  disabledUnitIds: Set<string>;
  onBoxSelect?: (unitIds: string[]) => void;
  onPreviewChange: (box: SelectionBox | null) => void;
}) {
  const map = useMap();
  const startRef = useRef<{ lat: number; lng: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      startRef.current = null;
      draggingRef.current = false;
      onPreviewChange(null);
      map.dragging.enable();
    }
  }, [enabled, map, onPreviewChange]);

  useEffect(() => {
    return () => {
      map.dragging.enable();
    };
  }, [map]);

  useMapEvents({
    mousedown(event) {
      if (!enabled) return;
      draggingRef.current = true;
      startRef.current = { lat: event.latlng.lat, lng: event.latlng.lng };
      map.dragging.disable();
      onPreviewChange(normalizeSelectionBox(startRef.current, startRef.current));
    },
    mousemove(event) {
      if (!enabled || !draggingRef.current || !startRef.current) return;
      onPreviewChange(
        normalizeSelectionBox(startRef.current, {
          lat: event.latlng.lat,
          lng: event.latlng.lng,
        }),
      );
    },
    mouseup(event) {
      if (!enabled || !draggingRef.current || !startRef.current) return;
      const box = normalizeSelectionBox(startRef.current, {
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
      const matchedIds = boundaryUnits
        .filter(
          (unit) =>
            !disabledUnitIds.has(unit.id) &&
            (
            centroidWithinSelection(unit.centroid, box) ||
            bboxIntersectsSelection(unit.bbox, box)
            ),
        )
        .map((unit) => unit.id);

      draggingRef.current = false;
      startRef.current = null;
      onPreviewChange(null);
      map.dragging.enable();
      onBoxSelect?.(matchedIds);
    },
  });

  return null;
}

export function TerritoryMap({
  parentBbox,
  boundaryUnits,
  selectedUnitIds = [],
  disabledUnitIds = [],
  disabledUnitLabels = {},
  onToggleUnit,
  highlightBbox,
  height = "400px",
  showBoundingBoxes = true,
  sizeByArea: _sizeByArea = false,
  enableBoxSelect = false,
  onBoxSelect,
}: TerritoryMapProps) {
  const [mapBounds, setMapBounds] = useState<LatLngBounds | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const initialBoundsSet = useRef(false);
  const disabledUnitIdSet = useMemo(() => new Set(disabledUnitIds), [disabledUnitIds]);

  // Calculate initial bounds only once
  useEffect(() => {
    if (initialBoundsSet.current) return;
    
    if (highlightBbox) {
      const southWest: [number, number] = [highlightBbox.south, highlightBbox.west];
      const northEast: [number, number] = [highlightBbox.north, highlightBbox.east];
      import("leaflet").then((L) => {
        setMapBounds(L.latLngBounds(southWest, northEast));
        initialBoundsSet.current = true;
      });
    } else if (parentBbox) {
      const southWest: [number, number] = [parentBbox.south, parentBbox.west];
      const northEast: [number, number] = [parentBbox.north, parentBbox.east];
      import("leaflet").then((L) => {
        setMapBounds(L.latLngBounds(southWest, northEast));
        initialBoundsSet.current = true;
      });
    }
  }, [highlightBbox, parentBbox]);

  // Convert bbox to rectangle bounds
  const parentRect = useMemo(() => {
    if (!parentBbox) return null;
    return [
      [parentBbox.south, parentBbox.west],
      [parentBbox.north, parentBbox.east],
    ] as [[number, number], [number, number]];
  }, [parentBbox]);

  const highlightRect = useMemo(() => {
    if (!highlightBbox) return null;
    return [
      [highlightBbox.south, highlightBbox.west],
      [highlightBbox.north, highlightBbox.east],
    ] as [[number, number], [number, number]];
  }, [highlightBbox]);

  // Convert bbox to rectangle bounds
  const getBboxBounds = (bbox: BoundaryUnit['bbox']): [[number, number], [number, number]] => {
    return [
      [bbox.south, bbox.west],
      [bbox.north, bbox.east],
    ];
  };

  return (
    <div style={{ height, width: "100%" }} className="rounded overflow-hidden border border-gray-300">
      <MapContainer
        center={TX_CENTER}
        zoom={6}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {mapBounds && <InitialBoundsFitter bounds={mapBounds} />}
        {!!boundaryUnits?.length && (
          <BoxSelectController
            enabled={enableBoxSelect}
            boundaryUnits={boundaryUnits}
            disabledUnitIds={disabledUnitIdSet}
            onBoxSelect={onBoxSelect}
            onPreviewChange={setSelectionBox}
          />
        )}

        {/* Parent territory context (shaded) */}
        {parentRect && (
          <Rectangle
            bounds={parentRect}
            pathOptions={{ color: "#6366f1", weight: 2, fillColor: "#6366f1", fillOpacity: 0.1 }}
          />
        )}

        {/* Highlighted selection */}
        {highlightRect && (
          <Rectangle
            bounds={highlightRect}
            pathOptions={{ color: "#10b981", weight: 3, fillColor: "#10b981", fillOpacity: 0.2 }}
          />
        )}

        {/* Drag selection preview */}
        {selectionBox && (
          <Rectangle
            bounds={selectionBoxToBounds(selectionBox)}
            pathOptions={{ color: "#2563eb", weight: 2, dashArray: "6 4", fillColor: "#60a5fa", fillOpacity: 0.15 }}
          />
        )}

        {/* Boundary units as bounding boxes (rectangles) */}
        {showBoundingBoxes && boundaryUnits?.map((unit) => {
          const isSelected = selectedUnitIds.includes(unit.id);
          const isDisabled = disabledUnitIdSet.has(unit.id);
          const bounds = getBboxBounds(unit.bbox);
          return (
            <Rectangle
              key={unit.id}
              bounds={bounds}
              eventHandlers={enableBoxSelect || isDisabled ? undefined : {
                click: () => onToggleUnit?.(unit.id),
              }}
              pathOptions={{
                color: isDisabled ? "#dc2626" : isSelected ? "#059669" : "#6b7280",
                fillColor: isDisabled ? "#fca5a5" : isSelected ? "#10b981" : "#e5e7eb",
                fillOpacity: isDisabled ? 0.35 : isSelected ? 0.4 : 0.2,
                weight: isDisabled || isSelected ? 2 : 1,
              }}
            >
              <Tooltip>
                {isDisabled
                  ? `${unit.name} (${disabledUnitLabels[unit.id] || "claimed by another territory"})`
                  : unit.name}
              </Tooltip>
            </Rectangle>
          );
        })}

        {/* Centroid markers for click targets when boxes are too small */}
        {boundaryUnits?.map((unit) => {
          const isSelected = selectedUnitIds.includes(unit.id);
          const isDisabled = disabledUnitIdSet.has(unit.id);
          return (
            <CircleMarker
              key={`centroid-${unit.id}`}
              center={[unit.centroid.lat, unit.centroid.lng]}
              radius={isSelected || isDisabled ? 8 : 5}
              eventHandlers={enableBoxSelect || isDisabled ? undefined : {
                click: () => onToggleUnit?.(unit.id),
              }}
              pathOptions={{
                color: isSelected || isDisabled ? "#ffffff" : "#6b7280",
                fillColor: isDisabled ? "#dc2626" : isSelected ? "#059669" : "#9ca3af",
                fillOpacity: 1,
                weight: 2,
              }}
            >
              <Tooltip>
                {isDisabled
                  ? `${unit.name} (${disabledUnitLabels[unit.id] || "claimed by another territory"})`
                  : `${unit.name} (click to ${isSelected ? 'remove' : 'add'})`}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

// Legend component
export function MapLegend() {
  return (
    <div className="flex gap-4 text-xs text-gray-600 mt-2">
      <div className="flex items-center gap-1">
        <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
        <span>Selected</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-3 h-3 rounded-full bg-gray-200 border border-gray-400 inline-block"></span>
        <span>Available (click to select)</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-3 h-3 bg-indigo-500/20 border border-indigo-500 inline-block"></span>
        <span>Parent territory</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-3 h-3 bg-red-300 border border-red-600 inline-block"></span>
        <span>Claimed by sibling</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-3 h-3 bg-blue-400/20 border border-blue-500 border-dashed inline-block"></span>
        <span>Drag select</span>
      </div>
    </div>
  );
}
