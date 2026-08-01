import clsx from "clsx";
import type { RangeKey, RangeState } from "../../hooks/useRange";

const OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

interface Props {
  value: RangeState;
  onChange: (next: RangeState) => void;
  className?: string;
}

export function RangeToggle({ value, onChange, className }: Props) {
  return (
    <div
      className={clsx(
        "inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm",
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const active = value.range === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange({ range: opt.key })}
            className={clsx(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              active
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
