import type {
  Ticket,
  TicketChainRow,
  TicketDetail,
  TicketFilters,
  TicketReassignment,
  TicketStatusUpdate,
} from "../types";

// Custom type for tickets API response
type TicketsResponse = {
  tickets: Ticket[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number | null;
  };
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

export class TicketsService {
  private static getAuthHeaders() {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  static async getTickets(filters: TicketFilters): Promise<TicketsResponse> {
    const params = new URLSearchParams();

    if (filters.status) params.append("status", filters.status);
    if (filters.areaId) params.append("areaId", filters.areaId);
    if (filters.assignedTechId)
      params.append("assignedTechId", filters.assignedTechId);
    if (filters.source) params.append("source", filters.source);
    if (filters.search) params.append("search", filters.search);
    if (filters.page) params.append("page", filters.page.toString());
    if (filters.limit) params.append("limit", filters.limit.toString());

    const response = await fetch(
      `${API_BASE_URL}/ops/tickets?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch tickets");
    }

    return response.json();
  }

  static async getTicket(id: string): Promise<TicketDetail> {
    const response = await fetch(`${API_BASE_URL}/ops/tickets/${id}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch ticket");
    }

    return response.json();
  }

  /**
   * Fetch the full lineage chain for a ticket with per-ticket operational
   * summaries. Numbers stay per-ticket and are never aggregated across the
   * chain (see docs/linked-tickets-architecture.md).
   */
  static async getTicketChain(id: string): Promise<TicketChainRow[]> {
    const response = await fetch(`${API_BASE_URL}/ops/tickets/${id}/chain`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error("Failed to fetch ticket chain");
    }
    const data = (await response.json()) as { chain: TicketChainRow[] };
    return data.chain;
  }

  static async getTicketEvents(id: string): Promise<unknown[]> {
    const response = await fetch(`${API_BASE_URL}/ops/tickets/${id}/events`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch ticket events");
    }

    return response.json();
  }

  static async reassignTicket(
    id: string,
    assignment: TicketReassignment,
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/tickets/${id}/assign`, {
      method: "PUT",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(assignment),
    });

    if (!response.ok) {
      throw new Error("Failed to reassign ticket");
    }
  }

  static async updateTicketStatus(
    id: string,
    update: TicketStatusUpdate,
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/tickets/${id}/status`, {
      method: "PUT",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(update),
    });

    if (!response.ok) {
      throw new Error("Failed to update ticket status");
    }
  }

  static async addTicketNote(id: string, note: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/tickets/${id}/notes`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ note }),
    });

    if (!response.ok) {
      throw new Error("Failed to add ticket note");
    }
  }

  static async searchTickets(query: string): Promise<Ticket[]> {
    const response = await fetch(
      `${API_BASE_URL}/ops/tickets/search?q=${encodeURIComponent(query)}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to search tickets");
    }

    return response.json();
  }

  static async exportTickets(filters: TicketFilters): Promise<Blob> {
    const params = new URLSearchParams();

    if (filters.status) params.append("status", filters.status);
    if (filters.areaId) params.append("areaId", filters.areaId);
    if (filters.assignedTechId)
      params.append("assignedTechId", filters.assignedTechId);
    if (filters.source) params.append("source", filters.source);

    const response = await fetch(
      `${API_BASE_URL}/ops/tickets/export?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to export tickets");
    }

    return response.blob();
  }
}
