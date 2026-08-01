import type {
  LoginRequest,
  LoginResponse,
  RefreshTokenResponse,
  PasswordChangeRequest,
  CreateUserRequest,
  UpdateUserRequest,
  ResetPasswordRequest,
  User,
  Area,
  AreaDetails,
} from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

export class AuthService {
  private static getAuthHeaders() {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  static async login(credentials: LoginRequest): Promise<LoginResponse & { requiresPasswordChange?: boolean; tempToken?: string }> {
    const response = await fetch(`${API_BASE_URL}/ops/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });

    // Check if response is JSON
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await response.text();
      console.error("[AuthService] Non-JSON response:", text.substring(0, 200));
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();

    // Handle password change required
    if (response.status === 403) {
      if (data.code === "PASSWORD_MUST_CHANGE") {
        return {
          requiresPasswordChange: true,
          tempToken: data.tempToken,
          token: "",
          user: { id: "", name: "", email: credentials.email, role: "TECH" },
        };
      }
      throw new Error(data.error || "Login failed");
    }

    if (!response.ok) {
      throw new Error(data.error || "Login failed");
    }

    // Store token in localStorage
    localStorage.setItem("auth_token", data.token);

    return data;
  }

  static async refreshToken(): Promise<RefreshTokenResponse> {
    const response = await fetch(`${API_BASE_URL}/ops/auth/refresh`, {
      method: "POST",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Token refresh failed");
    }

    const data = await response.json();

    // Update token in localStorage
    localStorage.setItem("auth_token", data.token);

    return data;
  }

  static async logout(): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/auth/logout`, {
      method: "DELETE",
      headers: this.getAuthHeaders(),
    });

    // Remove token from localStorage regardless of response
    localStorage.removeItem("auth_token");

    if (!response.ok) {
      throw new Error("Logout failed");
    }
  }

  static async changePassword(request: PasswordChangeRequest & { tempToken?: string }): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (request.tempToken) {
      headers["Authorization"] = `Bearer ${request.tempToken}`;
    }

    const response = await fetch(`${API_BASE_URL}/auth/password`, {
      method: "POST",
      headers,
      body: JSON.stringify({ currentPassword: request.currentPassword, newPassword: request.newPassword }),
    });

    if (!response.ok) {
      // Check if response is JSON
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Password change failed: ${response.status}`);
      }
      const data = await response.json();
      throw new Error(data.error || "Password change failed");
    }
  }

  // ---------- User Management (Admin) ----------

  static async getUsers(params?: { role?: string; areaId?: string; search?: string; includeInactive?: boolean }): Promise<{ users: User[] }> {
    const queryParams = new URLSearchParams();
    if (params?.role) queryParams.append("role", params.role);
    if (params?.areaId) queryParams.append("areaId", params.areaId);
    if (params?.search) queryParams.append("search", params.search);
    if (params?.includeInactive) queryParams.append("includeInactive", "true");

    const response = await fetch(`${API_BASE_URL}/ops/users?${queryParams}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch users");
    }

    return response.json();
  }

  static async getUser(id: string): Promise<{ user: User & { areaName?: string; supervisorName?: string; isActive: boolean; passwordMustChange: boolean; lastLoginAt?: number; createdAt: number } }> {
    const response = await fetch(`${API_BASE_URL}/ops/users/${id}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch user");
    }

    return response.json();
  }

  static async createUser(request: CreateUserRequest): Promise<User & { passwordMustChange: boolean }> {
    const response = await fetch(`${API_BASE_URL}/ops/users`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to create user");
    }

    return response.json();
  }

  static async updateUser(id: string, request: UpdateUserRequest): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/users/${id}`, {
      method: "PATCH",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to update user");
    }
  }

  static async resetPassword(id: string, request: ResetPasswordRequest): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/users/${id}/reset-password`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to reset password");
    }
  }

  static async deactivateUser(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/users/${id}`, {
      method: "DELETE",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to deactivate user");
    }
  }

  // ---------- Areas ----------

  static async getAreas(params?: { all?: boolean }): Promise<{ areas: Area[] }> {
    const query = params?.all ? "?all=1" : "";
    const response = await fetch(`${API_BASE_URL}/ops/areas${query}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[AuthService] getAreas failed:", response.status, errorText);
      throw new Error(`Failed to fetch areas: ${response.status}`);
    }

    return response.json();
  }

  static async getAreaDetails(id: string): Promise<AreaDetails> {
    const response = await fetch(`${API_BASE_URL}/ops/areas/${id}/details`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Failed to fetch area details");
    return response.json();
  }

  static async getUserAreas(userId: string): Promise<{ areas: { id: string; name: string; color?: string; assigned_at: number }[] }> {
    const response = await fetch(`${API_BASE_URL}/ops/users/${userId}/areas`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Failed to fetch user areas");
    return response.json();
  }

  static async setUserAreas(userId: string, areaIds: string[]): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/users/${userId}/areas`, {
      method: "PUT",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ areaIds }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to update user areas");
    }
  }

  static async createArea(name: string, managerId?: string): Promise<{ id: string; name: string; managerId?: string }> {
    const response = await fetch(`${API_BASE_URL}/ops/areas`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ name, managerId }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to create area");
    }

    return response.json();
  }

  static async updateArea(id: string, updates: { name?: string; managerId?: string; active?: boolean }): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/areas/${id}`, {
      method: "PATCH",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to update area");
    }
  }

  // ---------- Manual Ticket Assignment ----------

  static async assignTicket(ticketId: string, assignedTechId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/tickets/${ticketId}/assign`, {
      method: "PATCH",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ assignedTechId }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to assign ticket");
    }
  }

  static async unassignTicket(ticketId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ops/tickets/${ticketId}/unassign`, {
      method: "PATCH",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to unassign ticket");
    }
  }

  static getToken(): string | null {
    return localStorage.getItem("auth_token");
  }

  static isAuthenticated(): boolean {
    return !!this.getToken();
  }

  static clearToken(): void {
    localStorage.removeItem("auth_token");
  }
}
