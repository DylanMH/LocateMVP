import { useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { TerritoryNode } from "../types";

export const PALETTE = ["#2563EB", "#0F766E", "#DC2626", "#7C3AED", "#D97706", "#0891B2", "#4F46E5"];

export function flattenTerritories(nodes: TerritoryNode[]): TerritoryNode[] {
  const flattened: TerritoryNode[] = [];
  const visit = (node: TerritoryNode) => {
    flattened.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return flattened;
}

export function getBounds(territory: TerritoryNode): [[number, number], [number, number]] | null {
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

export function getCenter(territory: TerritoryNode): [number, number] | null {
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

export function makeTicketIcon(color: string, label: string) {
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

export function makeTechLocationIcon(name: string) {
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

export function MapRefocus({ center, minZoom = 9 }: { center: [number, number] | null; minZoom?: number }) {
  const map = useMap();
  const lastKey = useRef("");
  if (center) {
    const key = `${center[0].toFixed(3)},${center[1].toFixed(3)}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      map.flyTo(center, Math.max(map.getZoom(), minZoom), { duration: 0.8 });
    }
  }
  return null;
}
