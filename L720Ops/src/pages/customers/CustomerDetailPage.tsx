import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { OpsService } from "../../services/opsService";
import { useRange } from "../../hooks/useRange";
import { Metric, PageHeader, RangeToggle, Spinner } from "../../components/ui";

export function CustomerDetailPage() {
  const { id = "" } = useParams();
  const { state, setRange, toQuery } = useRange("month");
  const query = useQuery({
    queryKey: ["ops", "customer", id, state],
    queryFn: () => OpsService.getCustomerMetrics(id, toQuery()),
    enabled: Boolean(id),
  });
  const metrics = query.data?.metrics;
  const customer = query.data?.customer;

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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Metric label="Tickets" value={metrics?.ticketCount ?? 0} />
            <Metric label="Completed" value={metrics?.completed ?? 0} accent="green" />
            <Metric label="Fully clear" value={metrics?.fullyClear ?? 0} accent="blue" />
            <Metric label="Marked footage" value={`${(metrics?.markedFootage ?? 0).toLocaleString()} ft`} accent="purple" />
            <Metric label="COTP" value={metrics?.cotp == null ? "—" : `${metrics.cotp.toFixed(1)}%`} hint={metrics ? `${metrics.cotpNumerator}/${metrics.cotpDenominator} on time` : undefined} accent="yellow" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Metric label="Fully marked" value={metrics?.fullyMarked ?? 0} />
            <Metric label="Mixed" value={metrics?.mixed ?? 0} />
            <Metric label="Overdue completions" value={metrics?.overdueCompletions ?? 0} accent="red" />
            <Metric label="Avg ft / marked ticket" value={metrics?.averageFootagePerMarkedTicket == null ? "—" : Math.round(metrics.averageFootagePerMarkedTicket).toLocaleString()} accent="purple" />
          </div>
          <div className="bg-white rounded-lg border border-gray-100 p-5 text-sm text-gray-600">
            Technician, supervisor, area, date, and ticket-type breakdowns will use the same scoped customer contract as those dimensions are enabled.
          </div>
        </>
      )}
    </div>
  );
}
