import clsx from "clsx";

interface Props {
  ms: number | null | undefined;
  className?: string;
  short?: boolean;
}

export function formatDuration(ms: number | null | undefined, short = false) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return short ? `${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

export function DurationPill({ ms, className, short }: Props) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-xs font-medium text-gray-700",
        className,
      )}
    >
      {formatDuration(ms, short)}
    </span>
  );
}
