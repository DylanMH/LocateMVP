import type { DashboardStats } from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

export class DashboardService {
  private static getAuthHeaders() {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  static async getStats(): Promise<DashboardStats> {
    const response = await fetch(`${API_BASE_URL}/ops/dashboard/stats`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch dashboard stats");
    }

    return response.json();
  }

  static async getTechStatus(): Promise<unknown[]> {
    const response = await fetch(`${API_BASE_URL}/ops/dashboard/tech-status`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch tech status");
    }

    return response.json();
  }

  static async getTicketSummary(): Promise<unknown> {
    const response = await fetch(
      `${API_BASE_URL}/ops/dashboard/ticket-summary`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch ticket summary");
    }

    return response.json();
  }
}
