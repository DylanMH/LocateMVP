import type {
  SimulatorTicket,
  SimulatorTicketDetail,
  SimulatorTicketCreate,
  SimulatorTicketUpdate,
  SimulatorStats,
  SimulatorAreaStats,
} from "../types";

// Custom type for simulator API response
type SimulatorTicketsResponse = {
  tickets: SimulatorTicket[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const SIMULATOR_API_BASE_URL =
  import.meta.env.VITE_SIMULATOR_API_BASE_URL || "http://localhost:4100/api";

export class SimulatorService {
  private static getAuthHeaders() {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  static async getTickets(filters?: {
    status?: string;
    areaId?: string;
    page?: number;
    limit?: number;
  }): Promise<SimulatorTicketsResponse> {
    const params = new URLSearchParams();

    if (filters?.status) params.append("status", filters.status);
    if (filters?.areaId) params.append("areaId", filters.areaId);
    if (filters?.page) params.append("page", filters.page.toString());
    if (filters?.limit) params.append("limit", filters.limit.toString());

    const response = await fetch(
      `${SIMULATOR_API_BASE_URL}/ops/811/tickets?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch simulator tickets");
    }

    return response.json();
  }

  static async getTicket(id: string): Promise<SimulatorTicketDetail> {
    const response = await fetch(
      `${SIMULATOR_API_BASE_URL}/ops/811/tickets/${id}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch simulator ticket");
    }

    return response.json();
  }

  static async createTicket(
    ticket: SimulatorTicketCreate,
  ): Promise<{ id: string; ticketNumber: string; message: string }> {
    const response = await fetch(`${SIMULATOR_API_BASE_URL}/ops/811/tickets`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(ticket),
    });

    if (!response.ok) {
      throw new Error("Failed to create simulator ticket");
    }

    return response.json();
  }

  static async updateTicket(
    id: string,
    ticket: SimulatorTicketUpdate,
  ): Promise<{ id: string; message: string; updatedFields: string[] }> {
    const response = await fetch(
      `${SIMULATOR_API_BASE_URL}/ops/811/tickets/${id}`,
      {
        method: "PUT",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(ticket),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to update simulator ticket");
    }

    return response.json();
  }

  static async deleteTicket(
    id: string,
  ): Promise<{ message: string; ticketNumber: string }> {
    const response = await fetch(
      `${SIMULATOR_API_BASE_URL}/ops/811/tickets/${id}`,
      {
        method: "DELETE",
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to delete simulator ticket");
    }

    return response.json();
  }

  static async generateTestTickets(
    count: number = 5,
    areaId?: string,
  ): Promise<{
    message: string;
    tickets: Array<{ id: string; ticketNumber: string; areaId: string }>;
  }> {
    const response = await fetch(`${SIMULATOR_API_BASE_URL}/ops/811/generate`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ count, areaId }),
    });

    if (!response.ok) {
      throw new Error("Failed to generate test tickets");
    }

    return response.json();
  }

  static async resetDatabase(): Promise<{ message: string }> {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`${SIMULATOR_API_BASE_URL}/ops/811/reset`, {
      method: "DELETE",
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    });

    if (!response.ok) {
      throw new Error("Failed to reset simulator database");
    }

    return response.json();
  }

  static async getStats(): Promise<SimulatorStats> {
    const response = await fetch(`${SIMULATOR_API_BASE_URL}/ops/811/stats`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch simulator stats");
    }

    return response.json();
  }

  static async getAreaStats(): Promise<SimulatorAreaStats[]> {
    const response = await fetch(`${SIMULATOR_API_BASE_URL}/ops/811/areas`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch area stats");
    }

    return response.json();
  }

  static async getTicketMembers(id: string): Promise<unknown[]> {
    const response = await fetch(
      `${SIMULATOR_API_BASE_URL}/ops/811/tickets/${id}/members`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch ticket members");
    }

    return response.json();
  }

  static async updateMemberResponse(
    ticketId: string,
    memberId: string,
    memberResponse: { responseCode?: string; notes?: string },
  ): Promise<void> {
    const response = await fetch(
      `${SIMULATOR_API_BASE_URL}/ops/811/tickets/${ticketId}/members/${memberId}`,
      {
        method: "PUT",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(memberResponse),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to update member response");
    }
  }

  static async addMemberResponse(
    ticketId: string,
    memberResponse: {
      memberCode: string;
      utilityType: string;
      responseCode: string;
      notes?: string;
    },
  ): Promise<void> {
    const response = await fetch(
      `${SIMULATOR_API_BASE_URL}/ops/811/tickets/${ticketId}/responses`,
      {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(memberResponse),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to add member response");
    }
  }
}
