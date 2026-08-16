import clsx from "clsx";

export type BadgeKind =
  | "NEW"
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "EN_ROUTE"
  | "ENROUTE"
  | "ONSITE"
  | "PAUSED"
  | "CLOSED"
  | "UNABLE"
  | "COMPLETED"
  | "CLOCKED_IN"
  | "CLOCKED_OUT"
  | "ON_LUNCH"
  | "ON_PERSONAL"
  | "NORMAL"
  | "EMERGENCY"
  | "DIGUP"
  | "NON_COMPLIANT"
  | "UPDATE"
  | "UPDATE_REMARK"
  | "RECALL"
  | "NO_RESPONSE"
  | "811"
  | "INTERNAL"
  | string;

const MAP: Record<string, string> = {
  NEW: "bg-yellow-100 text-yellow-800",
  OPEN: "bg-yellow-100 text-yellow-800",
  ASSIGNED: "bg-blue-100 text-blue-800",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800",
  EN_ROUTE: "bg-purple-100 text-purple-800",
  ENROUTE: "bg-purple-100 text-purple-800",
  ONSITE: "bg-green-100 text-green-800",
  PAUSED: "bg-orange-100 text-orange-800",
  CLOSED: "bg-gray-200 text-gray-800",
  UNABLE: "bg-red-100 text-red-800",
  COMPLETED: "bg-gray-200 text-gray-800",

  CLOCKED_IN: "bg-green-100 text-green-800",
  CLOCKED_OUT: "bg-gray-200 text-gray-700",
  ON_LUNCH: "bg-amber-100 text-amber-800",
  ON_PERSONAL: "bg-sky-100 text-sky-800",

  // 811 ticket types
  NORMAL: "bg-blue-100 text-blue-800",
  EMERGENCY: "bg-red-100 text-red-800",
  DIGUP: "bg-orange-100 text-orange-800",
  NON_COMPLIANT: "bg-amber-100 text-amber-800",
  UPDATE: "bg-sky-100 text-sky-800",
  UPDATE_REMARK: "bg-sky-100 text-sky-800",
  RECALL: "bg-purple-100 text-purple-800",
  NO_RESPONSE: "bg-rose-100 text-rose-800",

  "811": "bg-violet-100 text-violet-800",
  INTERNAL: "bg-slate-100 text-slate-800",
};

interface Props {
  value: BadgeKind | null | undefined;
  className?: string;
  label?: string;
}

export function StatusBadge({ value, className, label }: Props) {
  if (!value) return null;
  const color = MAP[value] || "bg-gray-100 text-gray-700";
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold",
        color,
        className,
      )}
    >
      {label ?? String(value).replace(/_/g, " ")}
    </span>
  );
}
