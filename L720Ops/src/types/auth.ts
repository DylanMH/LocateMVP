export type UserRole = "TRAINEE" | "TRAINER" | "TECH" | "SUPERVISOR" | "AREA_MANAGER" | "DISTRICT_MANAGER" | "MANAGER" | "OPS_MANAGER";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  areaId?: string;
  supervisorId?: string;
  title?: string;
  phone?: string;
  permissions?: string[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refreshToken?: string;
  user: User;
}

export interface RefreshTokenRequest {
  token: string;
}

export interface RefreshTokenResponse {
  token: string;
  user?: User;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface PasswordChangeRequest {
  currentPassword?: string;
  newPassword: string;
}

export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  title?: string;
  role: UserRole;
  supervisorId?: string;
  areaId?: string;
  phone?: string;
  territoryId?: string;
  territoryIds?: string[];
  assignmentType?: "OWNER" | "MANAGER" | "TECH_ASSIGNMENT" | "TRAINER_SUPPORT";
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
  title?: string;
  role?: UserRole;
  supervisorId?: string;
  areaId?: string;
  phone?: string;
  isActive?: boolean;
}

export interface ResetPasswordRequest {
  newPassword: string;
}

export interface Area {
  id: string;
  name: string;
  managerId?: string;
  managerName?: string;
  techCount: number;
  active: boolean;
  bboxNorth?: number;
  bboxSouth?: number;
  bboxEast?: number;
  bboxWest?: number;
  centerLat?: number;
  centerLng?: number;
  color?: string;
}

export interface AreaAssignee {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  assigned_at: number;
}

export interface AreaTicketPin {
  id: string;
  ticket_number: string;
  address?: string;
  lat: number;
  lng: number;
  locator_status: string;
  assigned_tech_id?: string;
}

export interface AreaDetails {
  area: Area;
  assignees: AreaAssignee[];
  primaryTechs: Array<{ id: string; name: string; email: string; role: UserRole }>;
  tickets: AreaTicketPin[];
}
