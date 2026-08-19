export type TechRole = 'TRAINEE' | 'TRAINER' | 'TECH' | 'SUPERVISOR' | 'AREA_MANAGER' | 'DISTRICT_MANAGER';
export type AreaId = string;
export type ClockStatus = 'CLOCKED_IN' | 'CLOCKED_OUT';

export interface Tech {
  id: string;
  name: string;
  email: string;
  role: TechRole;
  areaId: AreaId;
  clockStatus: ClockStatus;
  activeTickets: number;
  totalAssigned: number;
  createdAt: number;
  lastActivity: number | null;
}

export interface TechStatus {
  id: string;
  name: string;
  email: string;
  role: TechRole;
  areaId: AreaId;
  clockStatus: ClockStatus;
  activeTickets: number;
  lastActivity: number | null;
}
