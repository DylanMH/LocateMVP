/**
 * Centralised fetch helper for every /api/ops/* call.
 * Handles auth header, JSON parsing, error normalisation, and query string building.
 * Keep this pure (no React) so services and hooks can share it freely.
 */

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:3000/api";

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type QueryParams = Record<string, QueryValue>;

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

export function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export function getAuthToken() {
  return localStorage.getItem("auth_token");
}

export async function opsFetch<T>(
  path: string,
  params?: QueryParams,
  init?: RequestInit,
): Promise<T> {
  const url = `${API_BASE_URL}${path}${buildQuery(params)}`;
  const response = await fetch(url, {
    ...init,
    headers: authHeaders(init?.headers),
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body?.error || message;
    } catch {
      // ignore
    }
    throw new Error(`${response.status} ${message} (${path})`);
  }
  return response.json() as Promise<T>;
}

export async function opsFetchBlob(
  path: string,
  params?: QueryParams,
): Promise<Blob> {
  const url = `${API_BASE_URL}${path}${buildQuery(params)}`;
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.blob();
}
