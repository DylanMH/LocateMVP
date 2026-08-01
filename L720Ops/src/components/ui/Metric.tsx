import clsx from "clsx";
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: "blue" | "green" | "yellow" | "red" | "gray" | "purple";
  className?: string;
}

const ACCENTS: Record<NonNullable<Props["accent"]>, string> = {
  blue: "bg-blue-100 text-blue-600",
  green: "bg-green-100 text-green-600",
  yellow: "bg-yellow-100 text-yellow-600",
  red: "bg-red-100 text-red-600",
  gray: "bg-gray-100 text-gray-600",
  purple: "bg-purple-100 text-purple-600",
};

export function Metric({
  label,
  value,
  hint,
  icon,
  accent = "blue",
  className,
}: Props) {
  return (
    <div
      className={clsx(
        "bg-white p-5 rounded-lg shadow-sm border border-gray-100 flex items-start gap-4",
        className,
      )}
    >
      {icon && (
        <div
          className={clsx(
            "flex-shrink-0 rounded-lg p-3 flex items-center justify-center",
            ACCENTS[accent],
          )}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
          {label}
        </div>
        <div className="text-2xl font-semibold text-gray-900 mt-1 truncate">
          {value}
        </div>
        {hint && (
          <div className="text-xs text-gray-500 mt-1 truncate">{hint}</div>
        )}
      </div>
    </div>
  );
}
