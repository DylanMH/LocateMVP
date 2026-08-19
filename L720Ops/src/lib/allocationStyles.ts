const ALLOCATION_LABELS: Record<string, string> = {
  locating: "Locating",
  training: "Training",
  truck_support: "Truck Support",
  meeting: "Meeting",
  oncall: "On Call",
  other: "Other",
};

export const ALLOCATION_COLORS: Record<string, string> = {
  locating: "#10B981",
  training: "#3B82F6",
  truck_support: "#F59E0B",
  meeting: "#8B5CF6",
  oncall: "#EC4899",
  other: "#6B7280",
};

export function allocationLabel(v: string | null | undefined): string {
  if (!v) return "Locating";
  return ALLOCATION_LABELS[v] || v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function allocationColor(v: string | null | undefined): string {
  if (!v) return ALLOCATION_COLORS.locating;
  return ALLOCATION_COLORS[v] || ALLOCATION_COLORS.other;
}
