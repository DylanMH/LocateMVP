import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "../../../config/api";
import { fetchWithTimeout } from "../../../utils/fetchWithTimeout";
import { logger } from "../../../utils/logger";

const AUTH_TOKEN_KEY = "@locate720:auth_token";

export type ExtensionType = "24_HOURS" | "48_HOURS" | "CUSTOM";
export type ReasonCode =
  | "ACCESS_ISSUE"
  | "CANNOT_FIND_ADDRESS"
  | "DAMAGE_INVESTIGATION"
  | "PROJECT_TICKET"
  | "WEATHER"
  | "OTHER";
export type RescheduleSource = "L720_INTERNAL" | "811_UPDATE" | "811_UPDATE_REMARK";
export type ExcavatorResponse = "AGREED_TO_RESCHEDULE" | "DISAGREED" | "PENDING";

export interface RescheduleRequest {
  ticketIds: string[];
  newDueAt: number;
  extensionType: ExtensionType;
  reasonCode: ReasonCode;
  reason?: string;
  approvalName?: string;
  approvalPhone?: string;
  excavatorResponse?: ExcavatorResponse;
  notes?: string;
  source?: RescheduleSource;
}

export interface RescheduleResult {
  ticketId: string;
  previousDueAt: number;
  newDueAt: number;
  originalDueAt: number;
  rescheduleId: string;
}

export interface BulkRescheduleResult {
  requestId: string;
  status: "OK" | "ERROR";
  rescheduledCount: number;
  results?: RescheduleResult[];
  error?: string;
}

/**
 * Reschedule one or more tickets via the backend API.
 * Uses an idempotent request ID so retries are safe.
 */
export async function rescheduleTickets(
  request: RescheduleRequest,
): Promise<BulkRescheduleResult> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error("Not authenticated");
  }

  const requestId = `reschedule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const isBulk = request.ticketIds.length > 1;

  const endpoint = isBulk
    ? `${API_BASE_URL}/tickets/reschedule-bulk`
    : `${API_BASE_URL}/tickets/${request.ticketIds[0]}/reschedule`;

  const body = isBulk
    ? {
        ticketIds: request.ticketIds,
        newDueAt: request.newDueAt,
        requestId,
        reasonCode: request.reasonCode,
        extensionType: request.extensionType,
        approvalName: request.approvalName,
        approvalPhone: request.approvalPhone,
        excavatorResponse: request.excavatorResponse,
        notes: request.notes,
        source: request.source || "L720_INTERNAL",
      }
    : {
        newDueAt: request.newDueAt,
        requestId,
        reasonCode: request.reasonCode,
        extensionType: request.extensionType,
        approvalName: request.approvalName,
        approvalPhone: request.approvalPhone,
        excavatorResponse: request.excavatorResponse,
        notes: request.notes,
        source: request.source || "L720_INTERNAL",
      };

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    timeout: 15000,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.error(`[Reschedule] Failed: HTTP ${response.status} ${text}`);
    throw new Error(`Reschedule failed: HTTP ${response.status}`);
  }

  return response.json();
}

export interface RescheduleHistoryEntry {
  id: string;
  ticket_id: string;
  previous_due_at: number;
  new_due_at: number;
  reason: string | null;
  reason_code: string | null;
  extension_type: string | null;
  approval_name: string | null;
  approval_phone: string | null;
  excavator_response: string | null;
  eight_one_one_revision_state: string | null;
  source: string;
  notes: string | null;
  created_at: number;
}

/**
 * Fetch reschedule history for a ticket.
 */
export async function getRescheduleHistory(
  ticketId: string,
): Promise<RescheduleHistoryEntry[]> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error("Not authenticated");
  }

  const response = await fetchWithTimeout(
    `${API_BASE_URL}/tickets/${ticketId}/reschedules`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 15000,
    },
  );

  if (!response.ok) {
    logger.error(`[Reschedule] History fetch failed: HTTP ${response.status}`);
    throw new Error(`Failed to fetch reschedule history`);
  }

  const data = await response.json();
  return data.reschedules || [];
}
