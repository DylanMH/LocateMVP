export type AreaId = "ROYSE_CITY" | "ROCKWALL" | "FATE";

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
  // Simple “good enough” bbox for testing map + assignment.
  return {
    latMin: centerLat - 0.03,
    latMax: centerLat + 0.03,
    lngMin: centerLng - 0.04,
    lngMax: centerLng + 0.04,
  };
}

export const AREAS: AreaSeed[] = [
  {
    id: "ROYSE_CITY",
    name: "Royse City, TX",
    centerLat: 32.9751,
    centerLng: -96.3325,
    ...bbox(32.9751, -96.3325),
  },
  {
    id: "ROCKWALL",
    name: "Rockwall, TX",
    centerLat: 32.9312,
    centerLng: -96.4597,
    ...bbox(32.9312, -96.4597),
  },
  {
    id: "FATE",
    name: "Fate, TX",
    centerLat: 32.9432,
    centerLng: -96.3904,
    ...bbox(32.9432, -96.3904),
  },
];
