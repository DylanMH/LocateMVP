import crypto from "node:crypto";

// Accept any ticket type string; scope sizing only specializes RECALL/EMERGENCY.
type TicketType = string;

type AreaBounds = {
  lat_min: number;
  lat_max: number;
  lng_min: number;
  lng_max: number;
};

type ScopeShape = {
  shape: "BOUNDING_BOX";
  centerLat: number;
  centerLng: number;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  widthFeet: number;
  heightFeet: number;
};

function getHashRatio(seed: string, offset: number): number {
  const hash = crypto.createHash("sha256").update(seed).digest();
  const value = hash.readUInt32BE(offset);
  return value / 0xffffffff;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function feetToLatitudeDelta(feet: number): number {
  return feet / 364000;
}

function feetToLongitudeDelta(feet: number, latitude: number): number {
  const safeCos = Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  return feet / (364000 * safeCos);
}

function getBaseScopeSizeFeet(workType: string, ticketType: TicketType) {
  const workTypeBase: Record<string, { widthFeet: number; heightFeet: number }> = {
    BORE: { widthFeet: 280, heightFeet: 180 },
    TRENCH: { widthFeet: 260, heightFeet: 170 },
    POLE: { widthFeet: 140, heightFeet: 120 },
    REPAIR: { widthFeet: 170, heightFeet: 130 },
    SERVICE_INSTALL: { widthFeet: 220, heightFeet: 150 },
    STANDARD: { widthFeet: 200, heightFeet: 140 },
  };

  const fallback = workTypeBase.STANDARD;
  const selected = workTypeBase[workType] || fallback;

  if (ticketType === "EMERGENCY") {
    return {
      widthFeet: selected.widthFeet + 70,
      heightFeet: selected.heightFeet + 40,
    };
  }

  // DigUp: high-priority damage/exposure — slightly larger scope than emergency.
  if (ticketType === "DIGUP") {
    return {
      widthFeet: selected.widthFeet + 80,
      heightFeet: selected.heightFeet + 45,
    };
  }

  if (ticketType === "RECALL") {
    return {
      widthFeet: selected.widthFeet + 35,
      heightFeet: selected.heightFeet + 20,
    };
  }

  // Non-Compliant: short-notice normal-ish work — same footprint as standard.
  return selected;
}

export function buildTicketScope(params: {
  seed: string;
  centerLat: number;
  centerLng: number;
  workType: string;
  ticketType: TicketType;
  areaBounds: AreaBounds;
}): ScopeShape {
  const { seed, centerLat, centerLng, workType, ticketType, areaBounds } = params;
  const base = getBaseScopeSizeFeet(workType, ticketType);
  const widthVariance = 0.85 + getHashRatio(`${seed}:width`, 0) * 0.3;
  const heightVariance = 0.85 + getHashRatio(`${seed}:height`, 4) * 0.3;
  const widthFeet = Math.round(base.widthFeet * widthVariance);
  const heightFeet = Math.round(base.heightFeet * heightVariance);

  const halfLatDelta = feetToLatitudeDelta(heightFeet) / 2;
  const halfLngDelta = feetToLongitudeDelta(widthFeet, centerLat) / 2;

  const latMin = clamp(centerLat - halfLatDelta, areaBounds.lat_min, areaBounds.lat_max);
  const latMax = clamp(centerLat + halfLatDelta, areaBounds.lat_min, areaBounds.lat_max);
  const lngMin = clamp(centerLng - halfLngDelta, areaBounds.lng_min, areaBounds.lng_max);
  const lngMax = clamp(centerLng + halfLngDelta, areaBounds.lng_min, areaBounds.lng_max);

  return {
    shape: "BOUNDING_BOX",
    centerLat,
    centerLng,
    latMin,
    latMax,
    lngMin,
    lngMax,
    widthFeet,
    heightFeet,
  };
}
