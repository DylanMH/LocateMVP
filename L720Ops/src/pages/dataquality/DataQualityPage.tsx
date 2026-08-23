import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { OpsService } from "../../services/opsService";
import { DataTable, type DataTableColumn, PageHeader, Spinner } from "../../components/ui";

interface QualityIssue {
  type: string;
  severity: string;
  entityType: string;
  entityId: string;
  message: string;
}

export function DataQualityPage() {
  const [severity, setSeverity] = useState<string>("");
  const [entityType, setEntityType] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const limit = 250;

  const query = useQuery({
    queryKey: ["ops", "data-quality", severity, entityType, offset],
    queryFn: () => OpsService.getDataQuality({
      limit,
      offset,
      severity: severity || undefined,
      entityType: entityType || undefined,
    }),
    refetchInterval: 300000,
  });

  const columns: DataTableColumn<QualityIssue>[] = [
    {
      key: "severity",
      header: "Severity",
      render: (issue) => (
        <span className={issue.severity === "ERROR" ? "font-semibold text-red-600" : "font-semibold text-yellow-600"}>
          {issue.severity}
        </span>
      ),
    },
    { key: "type", header: "Rule", render: (issue) => <span className="font-mono text-xs">{issue.type}</span> },
    { key: "entity", header: "Entity", render: (issue) => `${issue.entityType} · ${issue.entityId}` },
    { key: "message", header: "Details", render: (issue) => issue.message },
  ];

  const data = query.data;
  const hasMore = data?.truncated || false;
  const showing = data?.returnedCount ?? 0;
  const total = data?.issueCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Data Quality" subtitle="Development and management validation checks" />
      {query.isLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <div className="text-xs uppercase text-gray-500">Total issues</div>
              <div className="text-2xl font-semibold text-gray-900">{total}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <div className="text-xs uppercase text-gray-500">Errors</div>
              <div className="text-2xl font-semibold text-red-600">{data?.bySeverity?.ERROR ?? 0}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <div className="text-xs uppercase text-gray-500">Warnings</div>
              <div className="text-2xl font-semibold text-yellow-600">{data?.bySeverity?.WARN ?? 0}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <div className="text-xs uppercase text-gray-500">Rule types</div>
              <div className="text-2xl font-semibold text-gray-900">{Object.keys(data?.byType || {}).length}</div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Severity:</span>
              <select
                value={severity}
                onChange={(e) => { setSeverity(e.target.value); setOffset(0); }}
                className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-800"
              >
                <option value="">All</option>
                <option value="ERROR">Error</option>
                <option value="WARN">Warning</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Entity:</span>
              <select
                value={entityType}
                onChange={(e) => { setEntityType(e.target.value); setOffset(0); }}
                className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-800"
              >
                <option value="">All</option>
                <option value="TICKET">Ticket</option>
                <option value="USER">User</option>
                <option value="CUSTOMER">Customer</option>
              </select>
            </div>
            <div className="ml-auto text-xs text-gray-500">
              Showing {showing} of {total}
            </div>
          </div>

          <DataTable
            columns={columns}
            rows={data?.issues}
            rowKey={(issue) => `${issue.type}-${issue.entityType}-${issue.entityId}`}
            empty={{ title: "No data-quality issues", description: "The current checks found no issues matching the filters." }}
          />

          {/* Pagination */}
          {(offset > 0 || hasMore) && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-gray-700 disabled:opacity-50 hover:bg-gray-50"
              >
                ← Previous
              </button>
              <span className="text-xs text-gray-500">
                Page {Math.floor(offset / limit) + 1}
              </span>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={!hasMore}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-gray-700 disabled:opacity-50 hover:bg-gray-50"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
