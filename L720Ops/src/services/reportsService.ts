const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

export class ReportsService {
  private static getAuthHeaders() {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  static async getDailyReport(date?: string): Promise<unknown> {
    const params = date ? `?date=${encodeURIComponent(date)}` : "";
    const response = await fetch(`${API_BASE_URL}/ops/reports/daily${params}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch daily report");
    }

    return response.json();
  }

  static async getAreaReport(areaId?: string): Promise<unknown> {
    const params = areaId ? `?areaId=${encodeURIComponent(areaId)}` : "";
    const response = await fetch(`${API_BASE_URL}/ops/reports/area${params}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch area report");
    }

    return response.json();
  }

  static async getTechPerformance(techId?: string): Promise<unknown> {
    const params = techId ? `?techId=${encodeURIComponent(techId)}` : "";
    const response = await fetch(
      `${API_BASE_URL}/ops/reports/performance${params}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch tech performance report");
    }

    return response.json();
  }
}
