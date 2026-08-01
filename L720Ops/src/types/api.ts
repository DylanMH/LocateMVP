export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface DashboardStats {
  techs: {
    total: number;
    clockedIn: number;
    clockedOut: number;
  };
  tickets: {
    total: number;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
  };
  areas: Record<string, number>;
}

export interface TechStatusResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  areaId: string;
  clockStatus: string;
  activeTickets: number;
  lastActivity: number | null;
}

export interface SimulatorTicket {
  id: string;
  ticketNumber: string;
  ticketType: string;
  status: string;
  areaId: string;
  address: string;
  lat: number;
  lng: number;
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  version: number;
  memberCount: number;
  payloadJson: string;
}

export interface SimulatorStats {
  total: number;
  message: string;
}

export interface TicketReassignment {
  techId: string;
}

export interface TicketStatusUpdate {
  status?: string;
  locatorStatus?: string;
}
