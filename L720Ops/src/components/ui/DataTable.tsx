import clsx from "clsx";
import type { ReactNode } from "react";
import { Spinner } from "./Spinner";
import { EmptyState } from "./EmptyState";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
}

interface Props<T> {
  columns: DataTableColumn<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: { title: string; description?: ReactNode };
  onRowClick?: (row: T) => void;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  rowStyle?: (row: T) => React.CSSProperties | undefined;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  className,
  rowClassName,
  rowStyle,
}: Props<T>) {
  return (
    <div className={clsx("overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-100", className)}>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={clsx(
                  "px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider",
                  col.align === "right"
                    ? "text-right"
                    : col.align === "center"
                      ? "text-center"
                      : "text-left",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {loading && (!rows || rows.length === 0) ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center">
                <Spinner />
              </td>
            </tr>
          ) : rows && rows.length > 0 ? (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(
                  onRowClick && "cursor-pointer hover:bg-gray-50 transition-colors",
                  rowClassName?.(row),
                )}
                style={rowStyle?.(row)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={clsx(
                      "px-4 py-3 text-sm text-gray-700 whitespace-nowrap",
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left",
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState
                  title={empty?.title || "Nothing to display"}
                  description={empty?.description}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
