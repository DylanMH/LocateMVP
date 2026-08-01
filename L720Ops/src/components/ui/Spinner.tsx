import clsx from "clsx";

interface Props {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-4",
};

export function Spinner({ size = "md", className }: Props) {
  return (
    <div
      className={clsx(
        "inline-block animate-spin rounded-full border-gray-200 border-t-blue-600",
        SIZES[size],
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}
