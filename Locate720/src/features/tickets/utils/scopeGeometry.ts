import type { TicketScopeBounds } from "../types";
import { parseTicketPayload } from "./ticketPayload";

export interface LatLngCoordinate {
  latitude: number;
  longitude: number;
}

/**
 * Parse scope geometry from a ticket's payloadJson string.
 * Returns a polygon coordinate array suitable for react-native-maps Polygon,
 * or null if the scope cannot be resolved.
 *
 * Precedence:
 *  1. payload.scope.polygon[] — full polygon coordinates (future)
 *  2. payload.scope { latMin, latMax, lngMin, lngMax } — axis-aligned bounding box
 *  3. Fallback to a small default bbox around ticket lat/lng
 *
 * All access is wrapped in try/catch so callers never throw on malformed JSON.
 */
export function getScopePolygon(
  payloadJson?: string,
  ticketLat?: number | null,
  ticketLng?: number | null,
): LatLngCoordinate[] | null {
  try {
    const payload = parseTicketPayload(payloadJson);
    const scope = payload?.scope;

    // Case 1: Full polygon array (future-proof)
    if (scope && Array.isArray((scope as unknown as { polygon?: unknown }).polygon)) {
      const polygon = (scope as unknown as { polygon: unknown[] }).polygon;
      if (
        polygon.length >= 3 &&
        polygon.every(
          (pt: unknown) =>
            pt !== null &&
            typeof pt === "object" &&
            typeof (pt as Record<string, unknown>).latitude === "number" &&
            typeof (pt as Record<string, unknown>).longitude === "number",
        )
      ) {
        return polygon as LatLngCoordinate[];
      }
    }

    // Case 2: Bounding box
    if (scope && isScopeBounds(scope)) {
      return boundsToPolygon(scope);
    }

    // Case 3: Fallback to small default box around ticket location
    if (typeof ticketLat === "number" && typeof ticketLng === "number") {
      const latDelta = 0.00045;
      const lngDelta = 0.0006;
      return [
        { latitude: ticketLat - latDelta, longitude: ticketLng - lngDelta },
        { latitude: ticketLat - latDelta, longitude: ticketLng + lngDelta },
        { latitude: ticketLat + latDelta, longitude: ticketLng + lngDelta },
        { latitude: ticketLat + latDelta, longitude: ticketLng - lngDelta },
      ];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the raw TicketScopeBounds from payloadJson, or null if missing/invalid.
 */
export function getScopeBounds(payloadJson?: string): TicketScopeBounds | null {
  try {
    const payload = parseTicketPayload(payloadJson);
    const scope = payload?.scope;
    if (scope && isScopeBounds(scope)) {
      return scope;
    }
    return null;
  } catch {
    return null;
  }
}

function isScopeBounds(scope: unknown): scope is TicketScopeBounds {
  if (scope === null || typeof scope !== "object") return false;
  const s = scope as Record<string, unknown>;
  return (
    typeof s.latMin === "number" &&
    typeof s.latMax === "number" &&
    typeof s.lngMin === "number" &&
    typeof s.lngMax === "number"
  );
}

function boundsToPolygon(bounds: TicketScopeBounds): LatLngCoordinate[] {
  return [
    { latitude: bounds.latMin, longitude: bounds.lngMin },
    { latitude: bounds.latMin, longitude: bounds.lngMax },
    { latitude: bounds.latMax, longitude: bounds.lngMax },
    { latitude: bounds.latMax, longitude: bounds.lngMin },
  ];
}
