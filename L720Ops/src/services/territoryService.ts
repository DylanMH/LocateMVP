import type {
  Territory,
  TerritoryNode,
  TerritoryDetails,
  CreateTerritoryRequest,
  AssignmentType,
  UserHierarchy,
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    let msg = `Request failed: ${response.status}`;
    try {
      const data = JSON.parse(text);
      msg = data.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return response.json();
}

export const TerritoryService = {
  async getTree(): Promise<{ tree: TerritoryNode[] }> {
    return handle(await fetch(`${API_BASE_URL}/ops/territories?tree=1`, { headers: authHeaders() }));
  },

  async list(params?: { includeInactive?: boolean }): Promise<{ territories: Territory[] }> {
    const q = params?.includeInactive ? "?includeInactive=1" : "";
    return handle(await fetch(`${API_BASE_URL}/ops/territories${q}`, { headers: authHeaders() }));
  },

  async get(id: string): Promise<TerritoryDetails> {
    return handle(await fetch(`${API_BASE_URL}/ops/territories/${id}`, { headers: authHeaders() }));
  },

  async create(req: CreateTerritoryRequest): Promise<{ territory: Territory }> {
    return handle(
      await fetch(`${API_BASE_URL}/ops/territories`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(req),
      }),
    );
  },

  async update(id: string, patch: Partial<CreateTerritoryRequest> & { active?: boolean }): Promise<{ territory: Territory }> {
    return handle(
      await fetch(`${API_BASE_URL}/ops/territories/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(patch),
      }),
    );
  },

  async remove(id: string): Promise<void> {
    await handle(
      await fetch(`${API_BASE_URL}/ops/territories/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
  },

  async assignUser(territoryId: string, userId: string, assignmentType?: AssignmentType): Promise<void> {
    await handle(
      await fetch(`${API_BASE_URL}/ops/territories/${territoryId}/assignments`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ userId, assignmentType }),
      }),
    );
  },

  async unassignUser(territoryId: string, userId: string, type?: AssignmentType): Promise<void> {
    const q = type ? `?type=${type}` : "";
    await handle(
      await fetch(`${API_BASE_URL}/ops/territories/${territoryId}/assignments/${userId}${q}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
  },

  async getUserHierarchy(userId: string): Promise<{ user: { id: string; name: string; role: string }; hierarchy: UserHierarchy }> {
    return handle(await fetch(`${API_BASE_URL}/ops/territories/users/${userId}/hierarchy`, { headers: authHeaders() }));
  },

  // Geo data
  async getCounties(state = "TX"): Promise<{ counties: Array<{
    fips: string;
    name: string;
    state: string;
    stateFips: string;
    centroid: { lat: number; lng: number };
    bbox: { north: number; south: number; east: number; west: number };
  }> }> {
    return handle(await fetch(`${API_BASE_URL}/ops/territories/geo/counties?state=${state}`, { headers: authHeaders() }));
  },

  async getCities(state = "TX", countyFips?: string): Promise<{ cities: Array<{
    id: number;
    name: string;
    state: string;
    countyFips: string;
    countyName: string;
    lat: number;
    lng: number;
    population: number;
  }> }> {
    const q = countyFips ? `&countyFips=${countyFips}` : "";
    return handle(await fetch(`${API_BASE_URL}/ops/territories/geo/cities?state=${state}${q}`, { headers: authHeaders() }));
  },

  // Coverage management (legacy - kept for backward compatibility)
  async saveCoverage(territoryId: string, coverage: {
    counties?: string[];
    cities?: string[];
    zips?: string[];
  }): Promise<{ territory: Territory; coverage: { counties: string[]; cities: string[]; zips: string[] } }> {
    return handle(await fetch(`${API_BASE_URL}/ops/territories/${territoryId}/coverage`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(coverage),
    }));
  },

  // ========== BOUNDARY UNITS (real geographic data) ==========

  async getBoundaryUnits(options?: {
    type?: string;
    north?: number;
    south?: number;
    east?: number;
    west?: number;
    limit?: number;
  }): Promise<{
    units: Array<{
      id: string;
      sourceId: string;
      name: string;
      type: string;
      centroid: { lat: number; lng: number };
      bbox: { north: number; south: number; east: number; west: number };
      landArea?: number;
      waterArea?: number;
    }>;
    count: number;
  }> {
    const params = new URLSearchParams();
    if (options?.type) params.set("type", options.type);
    if (options?.north !== undefined) params.set("north", options.north.toString());
    if (options?.south !== undefined) params.set("south", options.south.toString());
    if (options?.east !== undefined) params.set("east", options.east.toString());
    if (options?.west !== undefined) params.set("west", options.west.toString());
    if (options?.limit !== undefined) params.set("limit", options.limit.toString());
    return handle(await fetch(`${API_BASE_URL}/ops/territories/boundary-units?${params}`, { headers: authHeaders() }));
  },

  async getBoundaryUnit(id: string): Promise<{
    unit: {
      id: string;
      sourceId: string;
      name: string;
      type: string;
      stateFips: string;
      centroid: { lat: number; lng: number };
      bbox: { north: number; south: number; east: number; west: number };
      landArea?: number;
      waterArea?: number;
      geometry?: unknown;
      sourceProperties?: unknown;
    };
  }> {
    return handle(await fetch(`${API_BASE_URL}/ops/territories/boundary-units/${id}`, { headers: authHeaders() }));
  },

  async getTerritoryBoundaryUnits(territoryId: string): Promise<{
    territoryId: string;
    units: Array<{
      id: string;
      sourceId: string;
      name: string;
      type: string;
      centroid: { lat: number; lng: number };
      bbox: { north: number; south: number; east: number; west: number };
    }>;
    count: number;
  }> {
    return handle(await fetch(`${API_BASE_URL}/ops/territories/${territoryId}/boundary-units`, { headers: authHeaders() }));
  },

  async assignBoundaryUnits(
    territoryId: string,
    boundaryUnitIds: string[],
    mode: "replace" | "append" = "replace"
  ): Promise<{
    territoryId: string;
    units: Array<{
      id: string;
      sourceId: string;
      name: string;
      type: string;
      centroid: { lat: number; lng: number };
    }>;
    count: number;
    assigned: number;
    rejected: number;
  }> {
    return handle(await fetch(`${API_BASE_URL}/ops/territories/${territoryId}/boundary-units`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ boundaryUnitIds, mode }),
    }));
  },

  async clearBoundaryUnits(territoryId: string): Promise<{ ok: true; territoryId: string }> {
    return handle(await fetch(`${API_BASE_URL}/ops/territories/${territoryId}/boundary-units`, {
      method: "DELETE",
      headers: authHeaders(),
    }));
  },
};
