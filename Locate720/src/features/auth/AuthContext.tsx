import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setCurrentUser } from './devSession';
import { SyncEngine } from '../tickets/sync/SyncEngine';
import { logger } from '../../utils/logger';

export type UserRole = 'TRAINEE' | 'TRAINER' | 'TECH' | 'SUPERVISOR' | 'AREA_MANAGER' | 'MANAGER';

interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  areaId?: string;
  supervisorId?: string;
  title?: string;
  phone?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (params: { token: string; refreshToken: string; user: User }) => Promise<void>;
  logout: (options?: { beforeLogout?: () => Promise<void> }) => Promise<void>;
  getAuthToken: () => Promise<string | null>;
  refreshAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_USER_KEY = '@locate720:auth_user';
const AUTH_TOKEN_KEY = '@locate720:auth_token';
const AUTH_REFRESH_TOKEN_KEY = '@locate720:auth_refresh_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const [storedUser, storedToken, storedRefreshToken] = await Promise.all([
        AsyncStorage.getItem(AUTH_USER_KEY),
        AsyncStorage.getItem(AUTH_TOKEN_KEY),
        AsyncStorage.getItem(AUTH_REFRESH_TOKEN_KEY),
      ]);

      if (storedUser && storedToken) {
        const userData = JSON.parse(storedUser);
        setUser(userData);
        setToken(storedToken);
        setRefreshToken(storedRefreshToken);
        setCurrentUser(userData);
        logger.log('[Auth] Loaded stored auth for:', userData.email);
      }
    } catch (error) {
      logger.error('[Auth] Failed to load stored auth:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async ({ token: newToken, refreshToken: newRefreshToken, user: userData }: { token: string; refreshToken: string; user: User }) => {
    try {
      await Promise.all([
        AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(userData)),
        AsyncStorage.setItem(AUTH_TOKEN_KEY, newToken),
        AsyncStorage.setItem(AUTH_REFRESH_TOKEN_KEY, newRefreshToken),
      ]);
      setToken(newToken);
      setRefreshToken(newRefreshToken);
      setUser(userData);
      setCurrentUser(userData);
      logger.log('[Auth] User logged in:', userData.email, '(', userData.role, ')');
    } catch (error) {
      logger.error('[Auth] Failed to save auth:', error);
      throw error;
    }
  };

  const logout = async (options?: { beforeLogout?: () => Promise<void> }) => {
    try {
      await options?.beforeLogout?.();
      // Clear SyncEngine state so it stops syncing and doesn't flush
      // the old user's pending events after logout
      await SyncEngine.clearCurrentUser();
      await Promise.all([
        AsyncStorage.removeItem(AUTH_USER_KEY),
        AsyncStorage.removeItem(AUTH_TOKEN_KEY),
        AsyncStorage.removeItem(AUTH_REFRESH_TOKEN_KEY),
      ]);
      setUser(null);
      setToken(null);
      setRefreshToken(null);
      setCurrentUser(null);
      logger.log('[Auth] User logged out');
    } catch (error) {
      logger.error('[Auth] Failed to logout:', error);
      throw error;
    }
  };

  const getAuthToken = async (): Promise<string | null> => {
    // Return current token from state if available
    if (token) return token;
    // Otherwise fetch from storage
    try {
      const stored = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      return stored;
    } catch (error) {
      logger.error('[Auth] Failed to get auth token:', error);
      return null;
    }
  };

  const refreshAccessToken = async (): Promise<string | null> => {
    try {
      const currentRefreshToken = refreshToken || await AsyncStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
      if (!currentRefreshToken) {
        logger.error('[Auth] No refresh token available');
        return null;
      }

      // Call the backend to refresh
      const { API_BASE_URL } = await import('../../config/api');
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: currentRefreshToken }),
      });

      if (!response.ok) {
        logger.error('[Auth] Token refresh failed:', response.status);
        // Clear auth state on refresh failure
        await logout();
        return null;
      }

      const data = await response.json();
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
      if (data.refreshToken) {
        await AsyncStorage.setItem(AUTH_REFRESH_TOKEN_KEY, data.refreshToken);
        setRefreshToken(data.refreshToken);
      }
      setToken(data.token);
      logger.log('[Auth] Token refreshed successfully');
      return data.token;
    } catch (error) {
      logger.error('[Auth] Failed to refresh token:', error);
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      token,
      refreshToken,
      isLoading,
      isAuthenticated: !!user && !!token,
      login,
      logout,
      getAuthToken,
      refreshAccessToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
