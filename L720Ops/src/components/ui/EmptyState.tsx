import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="text-gray-900 font-medium">{title}</div>
      {description && (
        <div className="text-sm text-gray-500 mt-1 max-w-md">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
