import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { OpsService } from "../../services/opsService";
import type { CustomerBreakdownRow } from "../../services/opsService";
import { useRange } from "../../hooks/useRange";
import {
  DataTable,
  type DataTableColumn,
  Metric,
  PageHeader,
  RangeToggle,
  Spinner,
} from "../../components/ui";

type BreakdownTab = "technician" | "supervisor" | "area" | "date" | "type";

const TABS: { key: BreakdownTab; label: string }[] = [
  { key: "technician", label: "By Technician" },
  { key: "supervisor", label: "By Supervisor" },
  { key: "area", label: "By Area" },
  { key: "date", label: "By Date" },
  { key: "type", label: "By Ticket Type" },
];

const breakdownColumns = (tab: BreakdownTab): DataTableColumn<CustomerBreakdownRow>[] => {
  const nameCol: DataTableColumn<CustomerBreakdownRow> = {
    key: "name",
    header: tab === "technician" ? "Technician" : tab === "supervisor" ? "Supervisor" : tab === "area" ? "Area" : tab === "date" ? "Date" : "Type",
    render: (r) => (
      <div className="font-medium text-gray-900">
        {tab === "technician" && (r.techName || "—")}
        {tab === "supervisor" && (r.supervisorName || "—")}
        {tab === "area" && (r.areaName || "—")}
        {tab === "date" && (r.date || "—")}
        {tab === "type" && (r.ticketType || "—")}
      </div>
    ),
  };

  const cols: DataTableColumn<CustomerBreakdownRow>[] = [
    nameCol,
    { key: "ticketCount", header: "Tickets", align: "right", render: (r) => <span className="tabular-nums">{r.ticketCount}</span> },
    { key: "completed", header: "Completed", align: "right", render: (r) => <span className="tabular-nums">{r.completed}</span> },
    { key: "fullyClear", header: "Clear", align: "right", render: (r) => <span className="tabular-nums">{r.fullyClear}</span> },
    { key: "fullyMarked", header: "Marked", align: "right", render: (r) => <span className="tabular-nums">{r.fullyMarked}</span> },
  ];

  if (tab !== "date" && tab !== "type") {
    cols.push({
      key: "clearRate",
      header: "Clear %",
      align: "right",
      render: (r) => (
        <span className="tabular-nums">
          {r.clearRate?.value == null ? "—" : `${r.clearRate.value.toFixed(1)}%`}
        </span>
      ),
    });
  }

  cols.push(
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
  );

  return cols;
};

export function CustomerDetailPage() {
  const { id = "" } = useParams();
  const { state, setRange, toQuery } = useRange("month");
  const [tab, setTab] = useState<BreakdownTab>("technician");

  const query = useQuery({
    queryKey: ["ops", "customer", id, state, "with-breakdowns"],
    queryFn: () => OpsService.getCustomerMetrics(id, toQuery()),
    enabled: Boolean(id),
  });
  const metrics = query.data?.metrics;
  const customer = query.data?.customer;
  const breakdowns = query.data?.breakdowns;

  const breakdownRows: CustomerBreakdownRow[] = (() => {
    if (!breakdowns) return [];
    if (tab === "technician") return breakdowns.byTechnician;
    if (tab === "supervisor") return breakdowns.bySupervisor;
    if (tab === "area") return breakdowns.byArea;
    if (tab === "date") return breakdowns.byDate;
    return breakdowns.byTicketType;
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer?.display_name || "Customer"}
        subtitle={customer ? `${customer.code} · ${customer.utility_type} · ${query.data?.range.label}` : "Customer analytics"}
        actions={<RangeToggle value={state} onChange={setRange} />}
      />
      <Link to="/customers" className="text-sm text-blue-600 hover:text-blue-800">← Back to customers</Link>
      {query.isLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <>
          {/* Primary metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Metric label="Tickets" value={metrics?.ticketCount ?? 0} />
            <Metric label="Completed" value={metrics?.completed ?? 0} accent="green" />
            <Metric label="Fully clear" value={metrics?.fullyClear ?? 0} accent="blue" />
            <Metric label="Marked footage" value={`${(metrics?.markedFootage ?? 0).toLocaleString()} ft`} accent="purple" />
            <Metric label="COTP" value={metrics?.cotp == null ? "—" : `${metrics.cotp.toFixed(1)}%`} hint={metrics ? `${metrics.cotpNumerator}/${metrics.cotpDenominator} on time` : undefined} accent="yellow" />
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Metric label="Open tickets" value={metrics?.openTickets ?? 0} accent="blue" />
            <Metric
              label="Clear %"
              value={metrics?.clearRate?.value == null ? "—" : `${metrics.clearRate.value.toFixed(1)}%`}
              hint={metrics ? `${metrics.clearRate.numerator}/${metrics.clearRate.denominator}` : undefined}
            />
            <Metric label="Fully marked" value={metrics?.fullyMarked ?? 0} />
            <Metric label="Mixed" value={metrics?.mixed ?? 0} />
            <Metric label="Overdue completions" value={metrics?.overdueCompletions ?? 0} accent="red" />
          </div>

          {/* Tertiary metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Metric label="Avg ft / marked" value={metrics?.averageFootagePerMarkedTicket == null ? "—" : Math.round(metrics.averageFootagePerMarkedTicket).toLocaleString()} accent="purple" />
            <Metric label="Avg min / ticket" value={metrics?.averageMinutesPerTicket == null ? "—" : metrics.averageMinutesPerTicket.toFixed(0)} />
            <Metric label="Avg onsite min" value={metrics?.averageOnsiteMinutes == null ? "—" : metrics.averageOnsiteMinutes.toFixed(0)} />
            <Metric label="Emergency tickets" value={metrics?.emergencyTickets ?? 0} accent="red" />
            <Metric label="Reschedules" value={metrics?.rescheduleCount ?? 0} />
          </div>

          {/* Breakdown tabs */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 mr-4">Breakdowns</h3>
              <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 first:border-l-0 ${
                      tab === t.key
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <DataTable
              columns={breakdownColumns(tab)}
              rows={breakdownRows}
              rowKey={(r) => `${r.techId || r.supervisorId || r.areaId || r.date || r.ticketType || "row"}`}
              empty={{ title: `No ${tab} breakdown data in range` }}
              className="border-none shadow-none rounded-none"
            />
          </div>
        </>
      )}
    </div>
  );
}
