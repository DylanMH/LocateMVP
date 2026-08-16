export type AreaId =
  | "JOSEPHINE"
  | "MABANK"
  | "GUN_BARREL"
  | "EUSTACE"
  | "TOOL"
  | "SEVEN_POINTS"
  | "HEATH"
  | "MCLENDON_CHISHOLM"
  | "KEMP"
  | "ENCHANTED_OAKS";

export type AreaSeed = {
  id: AreaId;
  name: string;
  centerLat: number;
  centerLng: number;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
};

function bbox(centerLat: number, centerLng: number) {
  return {
    latMin: centerLat - 0.03,
    latMax: centerLat + 0.03,
    lngMin: centerLng - 0.04,
    lngMax: centerLng + 0.04,
  };
}

export const AREAS: AreaSeed[] = [
  { id: "JOSEPHINE", name: "Josephine, TX", centerLat: 33.0596, centerLng: -96.3252, ...bbox(33.0596, -96.3252) },
  { id: "MABANK", name: "Mabank, TX", centerLat: 32.3710, centerLng: -96.1159, ...bbox(32.3710, -96.1159) },
  { id: "GUN_BARREL", name: "Gun Barrel City, TX", centerLat: 32.3276, centerLng: -96.1026, ...bbox(32.3276, -96.1026) },
  { id: "EUSTACE", name: "Eustace, TX", centerLat: 32.3129, centerLng: -96.0108, ...bbox(32.3129, -96.0108) },
  { id: "TOOL", name: "Tool, TX", centerLat: 32.2784, centerLng: -96.1763, ...bbox(32.2784, -96.1763) },
  { id: "SEVEN_POINTS", name: "Seven Points, TX", centerLat: 32.3283, centerLng: -96.2064, ...bbox(32.3283, -96.2064) },
  { id: "HEATH", name: "Heath, TX", centerLat: 32.8495, centerLng: -96.4750, ...bbox(32.8495, -96.4750) },
  { id: "MCLENDON_CHISHOLM", name: "McLendon-Chisholm, TX", centerLat: 32.8423, centerLng: -96.3814, ...bbox(32.8423, -96.3814) },
  { id: "KEMP", name: "Kemp, TX", centerLat: 32.4513, centerLng: -96.2254, ...bbox(32.4513, -96.2254) },
  { id: "ENCHANTED_OAKS", name: "Enchanted Oaks, TX", centerLat: 32.2648, centerLng: -96.1102, ...bbox(32.2648, -96.1102) },
];
