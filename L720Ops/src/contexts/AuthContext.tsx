import { createContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { AuthService } from "../services/authService";
import type { AuthState } from "../types";

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<{ requiresPasswordChange: boolean; tempToken?: string }>;
  logout: () => void;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  });

  useEffect(() => {
    // Check for existing token on mount
    const token = AuthService.getToken();
    if (token) {
      void (async () => {
        try {
          const response = await AuthService.refreshToken();
          setAuthState({
            user: response.user || null,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch {
          AuthService.clearToken();
          setAuthState({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      })();
    } else {
      setAuthState({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  }, []);

  const login = async (email: string, password: string) => {
    setAuthState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await AuthService.login({ email, password });

      // Check if password change is required
      if (response.requiresPasswordChange) {
        setAuthState((prev) => ({ ...prev, isLoading: false }));
        return { requiresPasswordChange: true, tempToken: response.tempToken };
      }

      // Normal login - store auth data
      localStorage.setItem("auth_token", response.token);
      if (response.refreshToken) {
        localStorage.setItem("auth_refresh_token", response.refreshToken);
      }

      setAuthState({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        isLoading: false,
      });
      return { requiresPasswordChange: false };
    } catch (error) {
      setAuthState((prev) => ({ ...prev, isLoading: false }));
      throw error;
    }
  };

  const logout = () => {
    AuthService.logout();
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_refresh_token");
    setAuthState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  };

  const refreshToken = async () => {
    if (!authState.token) return;

    try {
      const response = await AuthService.refreshToken();
      setAuthState((prev) => ({
        ...prev,
        token: response.token,
      }));
    } catch (error) {
      // If refresh fails, logout the user
      logout();
      throw error;
    }
  };

  const value: AuthContextType = {
    ...authState,
    login,
    logout,
    refreshToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
export type { AuthContextType };
