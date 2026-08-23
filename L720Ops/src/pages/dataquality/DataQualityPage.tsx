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
  const query = useQuery({
    queryKey: ["ops", "data-quality"],
    queryFn: () => OpsService.getDataQuality(),
    refetchInterval: 300000,
  });

  const columns: DataTableColumn<QualityIssue>[] = [
    { key: "severity", header: "Severity", render: (issue) => <span className={issue.severity === "ERROR" ? "font-semibold text-red-600" : "font-semibold text-yellow-600"}>{issue.severity}</span> },
    { key: "type", header: "Rule", render: (issue) => <span className="font-mono text-xs">{issue.type}</span> },
    { key: "entity", header: "Entity", render: (issue) => `${issue.entityType} · ${issue.entityId}` },
    { key: "message", header: "Details", render: (issue) => issue.message },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Data Quality" subtitle="Development and management validation checks" />
      {query.isLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-100 p-4"><div className="text-xs uppercase text-gray-500">Issues</div><div className="text-2xl font-semibold text-gray-900">{query.data?.issueCount ?? 0}</div></div>
            <div className="bg-white rounded-lg border border-gray-100 p-4"><div className="text-xs uppercase text-gray-500">Errors</div><div className="text-2xl font-semibold text-red-600">{Object.entries(query.data?.byType || {}).filter(([type]) => type.includes("MISSING") || type.includes("DUPLICATE") || type.includes("OVERLAPPING")).reduce((sum, [, count]) => sum + count, 0)}</div></div>
            <div className="bg-white rounded-lg border border-gray-100 p-4"><div className="text-xs uppercase text-gray-500">Rule types</div><div className="text-2xl font-semibold text-gray-900">{Object.keys(query.data?.byType || {}).length}</div></div>
            <div className="bg-white rounded-lg border border-gray-100 p-4"><div className="text-xs uppercase text-gray-500">Generated</div><div className="text-sm font-semibold text-gray-900 mt-2">{query.data?.generatedAt ? new Date(query.data.generatedAt).toLocaleString() : "—"}</div></div>
          </div>
          <DataTable columns={columns} rows={query.data?.issues} rowKey={(issue) => `${issue.type}-${issue.entityType}-${issue.entityId}`} empty={{ title: "No data-quality issues", description: "The current checks found no issues." }} />
        </>
      )}
    </div>
  );
}
