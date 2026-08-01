export type SimulatorTicketType =
  | "NORMAL"
  | "UPDATE_REMARK"
  | "RECALL"
  | "EMERGENCY";
export type SimulatorStatus = "NEW" | "SENT_TO_MEMBER" | "RESPONDED" | "CLOSED";
export type SimulatorAreaId = "ROYSE_CITY" | "ROCKWALL" | "FATE";

export interface SimulatorMember {
  id: string;
  memberCode: string;
  utilityType: string;
  companyName: string;
  status: string;
  responseCode: string | null;
  respondedAt: number | null;
  notes: string | null;
}

export interface SimulatorTicket {
  id: string;
  ticketNumber: string;
  ticketType: SimulatorTicketType;
  status: SimulatorStatus;
  areaId: SimulatorAreaId;
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

export interface SimulatorTicketDetail extends SimulatorTicket {
  members: SimulatorMember[];
  events: SimulatorEvent[];
}

export interface SimulatorEvent {
  id: string;
  type: string;
  payload: unknown;
  occurredAt: number;
}

export interface SimulatorTicketCreate {
  ticketNumber: string;
  ticketType?: SimulatorTicketType;
  areaId: SimulatorAreaId;
  address: string;
  lat: number;
  lng: number;
  workType?: string;
  contractor?: string;
  contractorPhone?: string;
  contactName?: string;
  contactEmail?: string;
  markingInstructions?: string;
  dueAt?: number;
}

export interface SimulatorTicketUpdate {
  ticketNumber?: string;
  ticketType?: SimulatorTicketType;
  status?: SimulatorStatus;
  areaId?: SimulatorAreaId;
  address?: string;
  lat?: number;
  lng?: number;
  workType?: string;
  contractor?: string;
  contractorPhone?: string;
  contactName?: string;
  contactEmail?: string;
  markingInstructions?: string;
  dueAt?: number;
}

export interface SimulatorStats {
  total: number;
  byStatus: Record<string, number>;
  byArea: Record<string, number>;
  byType: Record<string, number>;
  recent: SimulatorTicket[];
}

export interface SimulatorAreaStats {
  areaId: string;
  total: number;
  new: number;
  sent: number;
  responded: number;
  closed: number;
}
