import type { Tech, TechStatus } from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

export class TechsService {
  private static getAuthHeaders() {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  static async getTechs(filters?: {
    area?: string;
    status?: string;
  }): Promise<Tech[]> {
    const params = new URLSearchParams();
    if (filters?.area) params.append("area", filters.area);
    if (filters?.status) params.append("status", filters.status);

    const response = await fetch(
      `${API_BASE_URL}/ops/techs?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch technicians");
    }

    return response.json();
  }

  static async getTech(id: string): Promise<Tech> {
    const response = await fetch(`${API_BASE_URL}/ops/techs/${id}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch technician");
    }

    return response.json();
  }

  static async getTechStatus(): Promise<TechStatus[]> {
    const response = await fetch(`${API_BASE_URL}/ops/dashboard/tech-status`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch tech status");
    }

    return response.json();
  }

  static async getTechTickets(
    id: string,
    filters?: { status?: string },
  ): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.append("status", filters.status);

    const response = await fetch(
      `${API_BASE_URL}/ops/techs/${id}/tickets?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch tech tickets");
    }

    return response.json();
  }

  static async getTechActivity(id: string): Promise<unknown[]> {
    const response = await fetch(`${API_BASE_URL}/ops/techs/${id}/activity`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch tech activity");
    }

    return response.json();
  }

  static async clockInTech(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/techs/${id}/clock-in`, {
      method: "POST",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to clock in technician");
    }
  }

  static async clockOutTech(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/techs/${id}/clock-out`, {
      method: "POST",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to clock out technician");
    }
  }
}
