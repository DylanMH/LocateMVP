import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { OpsService } from "../../services/opsService";
import { useRange } from "../../hooks/useRange";
import {
  DataTable,
  type DataTableColumn,
  Metric,
  PageHeader,
  RangeToggle,
  Spinner,
  formatDuration,
} from "../../components/ui";
import type { CustomerSummaryRow } from "../../types/ops";

type CustomerRow = CustomerSummaryRow & {
  id: string;
  code: string;
  active: boolean | number;
};

export function CustomersPage() {
  const { state, setRange, toQuery, queryKey } = useRange("month");
  const [search, setSearch] = useState("");
  const [utilityType, setUtilityType] = useState("");

  const catalogQuery = useQuery({
    queryKey: ["ops", "customers", "catalog"],
    queryFn: () => OpsService.getCustomerCatalog(),
    staleTime: 300000,
  });
  const summaryQuery = useQuery({
    queryKey: ["ops", "customers", "summary", queryKey],
    queryFn: () => OpsService.getCustomerSummary(toQuery()),
    refetchInterval: 60000,
  });

  const rows = useMemo<CustomerRow[]>(() => {
    const summaryByKey = new Map(
      (summaryQuery.data?.customers || []).map((row) => [
        `${row.customerName || ""}:${row.utilityType || ""}`,
        row,
      ]),
    );
    return (catalogQuery.data?.customers || []).map((customer) => ({
      ...(summaryByKey.get(`${customer.displayName}:${customer.utilityType}`) || {
        footage: 0,
        minutes: 0,
        locatesClosed: 0,
        ticketCount: 0,
      }),
      id: customer.id,
      code: customer.code,
      active: customer.active,
      customerName: customer.displayName,
      utilityType: customer.utilityType,
    }));
  }, [catalogQuery.data, summaryQuery.data]);

  const filteredRows = useMemo(
    () => rows.filter((row) => {
      const matchesSearch = !search
        || row.customerName?.toLowerCase().includes(search.toLowerCase())
        || row.code.toLowerCase().includes(search.toLowerCase());
      return matchesSearch && (!utilityType || row.utilityType === utilityType);
    }),
    [rows, search, utilityType],
  );

  const totals = useMemo(() => filteredRows.reduce(
    (total, row) => ({
      customers: total.customers + 1,
      tickets: total.tickets + row.ticketCount,
      locatesClosed: total.locatesClosed + row.locatesClosed,
      footage: total.footage + row.footage,
      minutes: total.minutes + row.minutes,
    }),
    { customers: 0, tickets: 0, locatesClosed: 0, footage: 0, minutes: 0 },
  ), [filteredRows]);

  const utilityOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.utilityType).filter((value): value is string => Boolean(value)))).sort(),
    [rows],
  );

  const columns = useMemo<DataTableColumn<CustomerRow>[]>(() => [
    {
      key: "customer",
      header: "Customer",
      render: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.customerName || "Unknown customer"}</div>
          <div className="text-xs text-gray-500">{row.code}</div>
        </div>
      ),
    },
    { key: "utility", header: "Utility", render: (row) => row.utilityType || "—" },
    { key: "tickets", header: "Tickets", align: "right", render: (row) => row.ticketCount.toLocaleString() },
    { key: "closed", header: "Closed", align: "right", render: (row) => row.locatesClosed.toLocaleString() },
    {
      key: "footage",
      header: "Marked footage",
      align: "right",
      render: (row) => `${row.footage.toLocaleString()} ft`,
    },
    {
      key: "avgFootage",
      header: "Avg ft / ticket",
      align: "right",
      render: (row) => row.locatesClosed > 0 ? Math.round(row.footage / row.locatesClosed).toLocaleString() : "—",
    },
    {
      key: "time",
      header: "Production time",
      align: "right",
      render: (row) => formatDuration(row.minutes * 60000, true),
    },
  ], []);

  const exportCsv = () => {
    const header = ["Code", "Customer", "Utility", "Tickets", "Closed", "Footage", "Minutes"].join(",");
    const escape = (value: string | number | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const body = filteredRows.map((row) => [
      row.code, row.customerName, row.utilityType, row.ticketCount, row.locatesClosed, row.footage, row.minutes,
    ].map(escape).join(","));
    const blob = new Blob([[header, ...body].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "devops-customers.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const loading = catalogQuery.isLoading || summaryQuery.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle={summaryQuery.data?.range.label || "Customer production analytics"}
        actions={<RangeToggle value={state} onChange={setRange} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Metric label="Customers" value={totals.customers} />
        <Metric label="Tickets" value={totals.tickets.toLocaleString()} />
        <Metric label="Closed" value={totals.locatesClosed.toLocaleString()} accent="green" />
        <Metric label="Marked footage" value={`${totals.footage.toLocaleString()} ft`} accent="purple" />
        <Metric label="Production time" value={formatDuration(totals.minutes * 60000, true)} accent="blue" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 flex flex-col md:flex-row gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customers or codes"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={utilityType}
          onChange={(event) => setUtilityType(event.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All utility types</option>
          {utilityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Export CSV
        </button>
      </div>

      {loading && !catalogQuery.data ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <DataTable
          columns={columns}
          rows={filteredRows}
          rowKey={(row) => row.id}
          loading={loading}
          empty={{ title: "No customers found", description: "Try another search, utility type, or reporting range." }}
        />
      )}
    </div>
  );
}
