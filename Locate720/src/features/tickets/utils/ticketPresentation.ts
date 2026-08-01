import type { ComponentProps } from "react";
import { colors } from "../../../ui/colors";
import type Ionicons from "@expo/vector-icons/Ionicons";
import type { LocatorStatus } from "../domain/statusMachine";
import type { UtilityType } from "../types";

export function getTicketTypeColor(ticketType?: string): string {
  // Legacy "NORMAL" rows map to the new "ORIGINAL" color bucket.
  if (!ticketType || ticketType === "NORMAL" || ticketType === "ORIGINAL") return colors.primary;

  switch (ticketType) {
    case "EMERGENCY":
    case "NO_RESPONSE":
      return "#EF5350";
    case "NON_COMPLIANT":
      return "#66BB6A";
    case "UPDATE":
    case "UPDATE_REMARK":
    case "CORRECTION":
      return "#42A5F5";
    case "RECALL":
      return colors.primary;
    default:
      return colors.primary;
  }
}

export function shouldShowLocatorStatusBadge(status?: string | null): status is LocatorStatus {
  return status === "ENROUTE" || status === "ONSITE" || status === "PAUSED";
}

export function getLocatorStatusColor(status?: string | null): string {
  switch (status) {
    case "ONSITE":
      return colors.success;
    case "PAUSED":
      return colors.muted;
    case "ENROUTE":
      return colors.accent;
    default:
      return colors.primary;
  }
}

export function formatLocatorStatus(status?: string | null): string {
  switch (status) {
    case "ENROUTE":
      return "En Route";
    case "ONSITE":
      return "On Site";
    case "PAUSED":
      return "Paused";
    case "ASSIGNED":
      return "Assigned";
    case "CLOSED":
      return "Closed";
    case "UNABLE":
      return "Unable";
    default:
      return status || "";
  }
}

export function getUtilityColor(utility: UtilityType): string {
  switch (utility) {
    case "ELECTRIC":
      return "#E74C3C";
    case "GAS":
      return "#F1C40F";
    case "FIBER":
      return "#E67E22";
    case "COPPER":
      return "#2ECC71";
    case "WATER":
      return "#3498DB";
    case "SEWER":
      return "#27AE60";
    default:
      return "#95A5A6";
  }
}

export function getUtilityIcon(
  utility: UtilityType,
): ComponentProps<typeof Ionicons>["name"] {
  switch (utility) {
    case "ELECTRIC":
      return "flash";
    case "GAS":
      return "flame";
    case "FIBER":
      return "wifi";
    case "COPPER":
      return "call";
    case "WATER":
      return "water";
    case "SEWER":
      return "swap-vertical";
    default:
      return "help-circle";
  }
}
