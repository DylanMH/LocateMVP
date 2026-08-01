import type { UserRole } from "./auth";

export type TerritoryType = "DISTRICT" | "AREA" | "SUPERVISOR_TERRITORY" | "TECH_TERRITORY";

export type AssignmentType = "OWNER" | "MANAGER" | "TECH_ASSIGNMENT" | "TRAINER_SUPPORT";

export interface Territory {
  id: string;
  code: string;
  name: string;
  type: TerritoryType;
  parentTerritoryId: string | null;
  bboxNorth?: number | null;
  bboxSouth?: number | null;
  bboxEast?: number | null;
  bboxWest?: number | null;
  centerLat?: number | null;
  centerLng?: number | null;
  color?: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  owners?: Array<{ id: string; name: string; email: string; role: UserRole }>;
  assigneeCount?: number;
  coverageJson?: {
    counties?: string[];
    cities?: string[];
    zips?: string[];
  } | null;
}

export interface TerritoryNode extends Territory {
  children: TerritoryNode[];
}

export interface TerritoryAssignment {
  assignmentId: string;
  userId: string;
  assignmentType: AssignmentType;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  startDate?: number | null;
  endDate?: number | null;
  createdAt: number;
}

export interface TerritoryDetails {
  territory: Territory;
  parentChain: Territory[];
  children: Territory[];
  assignments: TerritoryAssignment[];
}

export interface CreateTerritoryRequest {
  code: string;
  name: string;
  type: TerritoryType;
  parentTerritoryId?: string | null;
  bboxNorth?: number | null;
  bboxSouth?: number | null;
  bboxEast?: number | null;
  bboxWest?: number | null;
  centerLat?: number | null;
  centerLng?: number | null;
  color?: string | null;
}

export interface UserHierarchyEntry {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  territoryId: string;
  territoryCode: string;
  territoryName: string;
}

export interface UserHierarchy {
  supervisors: UserHierarchyEntry[];
  areaManagers: UserHierarchyEntry[];
  districtManagers: UserHierarchyEntry[];
}
