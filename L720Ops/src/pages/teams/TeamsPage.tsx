import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { OpsService } from "../../services/opsService";
import type {
  HierarchyAggregate,
  HierarchyComparisonRow,
  TechMetricsRow,
} from "../../services/opsService";
import { useRange } from "../../hooks/useRange";
import {
  DataTable,
  type DataTableColumn,
  Metric,
  PageHeader,
  RangeToggle,
  Spinner,
} from "../../components/ui";

type Level = "district" | "area" | "supervisor";

function levelLabel(level: Level) {
  return { district: "District", area: "Area", supervisor: "Supervisor" }[level];
}

function AggregateKpis({ aggregate }: { aggregate: HierarchyAggregate }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <Metric label="Techs" value={aggregate.techCount} />
      <Metric label="Completed" value={aggregate.completed} accent="green" />
      <Metric label="Fully clear" value={aggregate.fullyClear} accent="blue" />
      <Metric label="Marked footage" value={`${aggregate.markedFootage.toLocaleString()} ft`} accent="purple" />
      <Metric
        label="COTP"
        value={aggregate.cotp == null ? "—" : `${aggregate.cotp.toFixed(1)}%`}
        hint={`${aggregate.cotpNumerator}/${aggregate.cotpDenominator} on time`}
        accent="yellow"
      />
      <Metric label="Open backlog" value={aggregate.openBacklog} accent="blue" />
      <Metric label="Overdue" value={aggregate.overdue} accent="red" />
      <Metric label="Worked hours" value={aggregate.workedHours.toFixed(1)} />
      <Metric
        label="Tickets/hr"
        value={aggregate.ticketsPerHour == null ? "—" : aggregate.ticketsPerHour.toFixed(1)}
      />
      <Metric
        label="Footage/hr"
        value={aggregate.footagePerHour == null ? "—" : Math.round(aggregate.footagePerHour).toLocaleString()}
      />
    </div>
  );
}

const comparisonColumns: DataTableColumn<HierarchyComparisonRow>[] = [
  {
    key: "name",
    header: "Name",
    render: (r) => (
      <div>
        <div className="font-medium text-gray-900">{r.territoryName || r.supervisor?.name || "—"}</div>
        {r.territoryCode && <div className="text-xs text-gray-500">{r.territoryCode}</div>}
      </div>
    ),
  },
  { key: "techCount", header: "Techs", align: "right", render: (r) => <span className="tabular-nums">{r.techCount}</span> },
  { key: "completed", header: "Completed", align: "right", render: (r) => <span className="tabular-nums">{r.completed}</span> },
  {
    key: "clearRate",
    header: "Clear %",
    align: "right",
    render: (r) => (
      <span className="tabular-nums">
        {r.clearRate.value == null ? "—" : `${r.clearRate.value.toFixed(1)}%`}
      </span>
    ),
  },
  {
    key: "cotp",
    header: "COTP",
    align: "right",
    render: (r) => (
      <span className="tabular-nums">
        {r.cotp == null ? "—" : `${r.cotp.toFixed(1)}%`}
      </span>
    ),
  },
  {
    key: "markedFootage",
    header: "Footage",
    align: "right",
    render: (r) => <span className="tabular-nums">{r.markedFootage.toLocaleString()}</span>,
  },
  {
    key: "workedHours",
    header: "Hours",
    align: "right",
    render: (r) => <span className="tabular-nums">{r.workedHours.toFixed(1)}</span>,
  },
  {
    key: "openBacklog",
    header: "Backlog",
    align: "right",
    render: (r) => <span className="tabular-nums text-blue-700">{r.openBacklog}</span>,
  },
  {
    key: "overdue",
    header: "Overdue",
    align: "right",
    render: (r) => <span className={`tabular-nums ${r.overdue > 0 ? "text-red-600 font-semibold" : ""}`}>{r.overdue}</span>,
  },
];

const techColumns: DataTableColumn<TechMetricsRow>[] = [
  {
    key: "tech",
    header: "Technician",
    render: (r) => (
      <Link to={`/techs/${r.techId}`} className="text-blue-600 hover:text-blue-800 font-medium">
        {r.techName}
      </Link>
    ),
  },
  { key: "completed", header: "Completed", align: "right", render: (r) => <span className="tabular-nums">{r.completed}</span> },
  {
    key: "clearRate",
    header: "Clear %",
    align: "right",
    render: (r) => (
      <span className="tabular-nums">
        {r.clearRate.value == null ? "—" : `${r.clearRate.value.toFixed(1)}%`}
      </span>
    ),
  },
  {
    key: "cotp",
    header: "COTP",
    align: "right",
    render: (r) => (
      <span className="tabular-nums">
        {r.cotp == null ? "—" : `${r.cotp.toFixed(1)}%`}
      </span>
    ),
  },
  {
    key: "markedFootage",
    header: "Footage",
    align: "right",
    render: (r) => <span className="tabular-nums">{r.markedFootage.toLocaleString()}</span>,
  },
  {
    key: "workedHours",
    header: "Hours",
    align: "right",
    render: (r) => <span className="tabular-nums">{r.workedHours.toFixed(1)}</span>,
  },
  {
    key: "openBacklog",
    header: "Backlog",
    align: "right",
    render: (r) => <span className="tabular-nums text-blue-700">{r.openBacklog}</span>,
  },
  {
    key: "overdue",
    header: "Overdue",
    align: "right",
    render: (r) => <span className={`tabular-nums ${r.overdue > 0 ? "text-red-600 font-semibold" : ""}`}>{r.overdue}</span>,
  },
];

export function TeamsPage() {
  const { user } = useAuth();
  const { state, setRange, toQuery, queryKey } = useRange("month");
  const [searchParams, setSearchParams] = useSearchParams();
  const districtId = searchParams.get("district") || undefined;
  const areaId = searchParams.get("area") || undefined;
  const supervisorId = searchParams.get("supervisor") || undefined;

  const role = user?.role || "";
  const canViewDistrict = role === "DISTRICT_MANAGER";
  const canViewArea = role === "AREA_MANAGER" || role === "DISTRICT_MANAGER";

  // Determine current level
  let level: Level = "supervisor";
  if (supervisorId) level = "supervisor";
  else if (areaId) level = "area";
  else if (districtId) level = "district";
  else if (canViewDistrict) level = "district";
  else if (canViewArea) level = "area";

  // District list (for district managers who haven't drilled in)
  const districtsQuery = useQuery({
    queryKey: ["ops", "districts"],
    queryFn: () => OpsService.getDistricts(),
    enabled: canViewDistrict && !districtId,
  });

  // District metrics (when a district is selected)
  const districtMetricsQuery = useQuery({
    queryKey: ["ops", "district-metrics", districtId, queryKey],
    queryFn: () => OpsService.getDistrictMetrics(districtId!, toQuery()),
    enabled: Boolean(districtId),
  });

  // Area metrics (when an area is selected)
  const areaMetricsQuery = useQuery({
    queryKey: ["ops", "area-metrics", areaId, queryKey],
    queryFn: () => OpsService.getAreaMetrics(areaId!, toQuery()),
    enabled: Boolean(areaId),
  });

  // Supervisor metrics (when a supervisor territory is selected)
  const supervisorMetricsQuery = useQuery({
    queryKey: ["ops", "supervisor-metrics", supervisorId, queryKey],
    queryFn: () => OpsService.getSupervisorMetrics(supervisorId!, toQuery()),
    enabled: Boolean(supervisorId),
  });

  // Supervisors list (default view for area managers)
  const supervisorsQuery = useQuery({
    queryKey: ["ops", "supervisors", queryKey],
    queryFn: () => OpsService.getSupervisors(toQuery()),
    enabled: !districtId && !areaId && !supervisorId,
  });

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    // Clear deeper levels when setting a shallower one
    if (key === "district") { params.delete("area"); params.delete("supervisor"); }
    if (key === "area") { params.delete("supervisor"); }
    setSearchParams(params, { replace: true });
  };

  const isLoading =
    (level === "district" && districtId && districtMetricsQuery.isLoading) ||
    (level === "area" && areaId && areaMetricsQuery.isLoading) ||
    (level === "supervisor" && supervisorId && supervisorMetricsQuery.isLoading) ||
    (!districtId && !areaId && !supervisorId && supervisorsQuery.isLoading);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        subtitle={`${levelLabel(level)} comparison · ${state.range}`}
        actions={<RangeToggle value={state} onChange={setRange} />}
      />

      {/* Breadcrumb / drilldown navigation */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => { setParam("district", null); setParam("area", null); setParam("supervisor", null); }}
          className={`px-2 py-1 rounded ${!districtId && !areaId && !supervisorId ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-100"}`}
        >
          All
        </button>
        {districtId && (
          <>
            <span className="text-gray-400">/</span>
            <button
              onClick={() => { setParam("area", null); setParam("supervisor", null); }}
              className={`px-2 py-1 rounded ${!areaId && !supervisorId ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-100"}`}
            >
              District
            </button>
          </>
        )}
        {areaId && (
          <>
            <span className="text-gray-400">/</span>
            <button
              onClick={() => setParam("supervisor", null)}
              className={`px-2 py-1 rounded ${!supervisorId ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-100"}`}
            >
              Area
            </button>
          </>
        )}
        {supervisorId && (
          <>
            <span className="text-gray-400">/</span>
            <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 font-medium">Supervisor</span>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* District list (no district selected) */}
          {canViewDistrict && !districtId && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Districts</h3>
              </div>
              <div className="px-5 py-3 space-y-2">
                {(districtsQuery.data?.districts || []).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setParam("district", d.id)}
                    className="w-full text-left px-3 py-2 rounded-md border border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                  >
                    <div className="font-medium text-gray-900">{d.name}</div>
                    <div className="text-xs text-gray-500">{d.code}</div>
                  </button>
                ))}
                {(!districtsQuery.data?.districts || districtsQuery.data.districts.length === 0) && (
                  <div className="text-sm text-gray-500 text-center py-4">No districts found.</div>
                )}
              </div>
            </div>
          )}

          {/* District metrics (area comparison) */}
          {districtId && districtMetricsQuery.data && (
            <>
              <AggregateKpis aggregate={districtMetricsQuery.data.aggregate} />
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Areas in {districtMetricsQuery.data.district?.name || "district"}
                  </h3>
                </div>
                <DataTable
                  columns={comparisonColumns}
                  rows={districtMetricsQuery.data.areas}
                  rowKey={(r) => r.territoryId}
                  onRowClick={(r) => setParam("area", r.territoryId)}
                  empty={{ title: "No areas found" }}
                  className="border-none shadow-none rounded-none"
                />
              </div>
            </>
          )}

          {/* Area metrics (supervisor comparison) */}
          {areaId && areaMetricsQuery.data && (
            <>
              <AggregateKpis aggregate={areaMetricsQuery.data.aggregate} />
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Supervisors in {areaMetricsQuery.data.area?.name || "area"}
                  </h3>
                </div>
                <DataTable
                  columns={comparisonColumns}
                  rows={areaMetricsQuery.data.supervisors}
                  rowKey={(r) => r.territoryId}
                  onRowClick={(r) => setParam("supervisor", r.territoryId)}
                  empty={{ title: "No supervisors found" }}
                  className="border-none shadow-none rounded-none"
                />
              </div>
            </>
          )}

          {/* Supervisor metrics (tech breakdown) */}
          {supervisorId && supervisorMetricsQuery.data && (
            <>
              <AggregateKpis aggregate={supervisorMetricsQuery.data.aggregate} />
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Technicians under {supervisorMetricsQuery.data.supervisor?.name || "supervisor"}
                  </h3>
                </div>
                <DataTable
                  columns={techColumns}
                  rows={supervisorMetricsQuery.data.techs}
                  rowKey={(r) => r.techId}
                  empty={{ title: "No technicians found" }}
                  className="border-none shadow-none rounded-none"
                />
              </div>
            </>
          )}

          {/* Default supervisors list (no drilldown) */}
          {!districtId && !areaId && !supervisorId && supervisorsQuery.data && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Supervisor Teams</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Click a row to drill into technician-level metrics
                </p>
              </div>
              <DataTable
                columns={comparisonColumns}
                rows={supervisorsQuery.data.supervisors}
                rowKey={(r) => r.territoryId}
                onRowClick={(r) => setParam("supervisor", r.territoryId)}
                empty={{ title: "No supervisor teams in scope" }}
                className="border-none shadow-none rounded-none"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
