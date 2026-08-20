const BACKEND_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

export class BackendService {
  private static getAuthHeaders() {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  /**
   * Pull tickets from 811 Simulator into Backend
   */
  static async pull811Tickets(since?: number): Promise<{
    success: boolean;
    pull: { ingested: number; updated: number; errors: string[] };
    assignment: { assigned: number; errors: string[] };
    message: string;
  }> {
    const response = await fetch(`${BACKEND_API_BASE_URL}/inbound/811/pull`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ since, assign: true }),
    });

    if (!response.ok) {
      throw new Error("Failed to pull 811 tickets");
    }

    return response.json();
  }

  /**
   * Get 811 ingestion status
   */
  static async get811Status(): Promise<{
    success: boolean;
    status: {
      total811Tickets: number;
      last811Sync: number;
      lastSyncTime: string | null;
      assignmentStats: any;
      recentTickets: any[];
    };
  }> {
    const response = await fetch(`${BACKEND_API_BASE_URL}/inbound/811/status`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to get 811 status");
    }

    return response.json();
  }

  /**
   * Reset all 811 tickets in Backend
   */
  static async reset811Tickets(): Promise<{
    success: boolean;
    deleted: number;
    message: string;
  }> {
    const response = await fetch(`${BACKEND_API_BASE_URL}/inbound/811/reset`, {
      method: "POST",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to reset 811 tickets");
    }

    return response.json();
  }

  /**
   * DEV ONLY: Reset ALL tickets in the L720 Backend (not just 811 source)
   */
  static async resetAllTickets(): Promise<{
    success: boolean;
    deleted: number;
    message: string;
  }> {
    const response = await fetch(`${BACKEND_API_BASE_URL}/inbound/811/reset-all`, {
      method: "POST",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to reset all tickets");
    }

    return response.json();
  }

  /**
   * Manually trigger assignment for unassigned tickets
   */
  static async assign811Tickets(): Promise<{
    success: boolean;
    results: { assigned: number; errors: string[] };
    message: string;
  }> {
    const response = await fetch(`${BACKEND_API_BASE_URL}/inbound/811/assign`, {
      method: "POST",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to assign 811 tickets");
    }

    return response.json();
  }
}
