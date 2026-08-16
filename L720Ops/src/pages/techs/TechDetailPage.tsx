import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { OpsService } from "../../services/opsService";
import { useRange } from "../../hooks/useRange";
import {
  DataTable,
  type DataTableColumn,
  Metric,
  PageHeader,
  RangeToggle,
  Spinner,
  StatusBadge,
  formatDuration,
} from "../../components/ui";
import {
  ArrowLeftIcon,
  BanknotesIcon,
  ChartBarSquareIcon,
  CheckCircleIcon,
  ClockIcon,
  MapIcon,
} from "@heroicons/react/24/outline";
import type { TicketDetailResponse } from "../../types/ops";
import { useEffect, useState } from "react";

export function TechDetailPage() {
  const { id = "" } = useParams();
  const { state: range, setRange, toQuery, queryKey } = useRange("day");

  const techQuery = useQuery({
    queryKey: ["ops", "techs", "detail", id, queryKey],
    queryFn: () => OpsService.getTech(id, toQuery()),
    enabled: Boolean(id),
    refetchInterval: 30000,
  });

  const ticketsQuery = useQuery({
    queryKey: ["ops", "techs", "tickets", id, queryKey],
    queryFn: () => OpsService.getTechTickets(id, toQuery()),
    enabled: Boolean(id),
    refetchInterval: 30000,
  });

  const timesheetQuery = useQuery({
    queryKey: ["ops", "timesheet", id, queryKey],
    queryFn: () => OpsService.getTechTimesheet(id, toQuery()),
    enabled: Boolean(id),
    refetchInterval: 60000,
  });

  // live timer for current session
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const tech = techQuery.data;

  const ticketColumns: DataTableColumn<TicketDetailResponse>[] = [
    {
      key: "ticket",
      header: "Ticket",
      render: (t) => (
        <div>
          <div className="font-medium text-gray-900">{t.ticketNumber}</div>
          <div className="text-xs text-gray-500 truncate max-w-xs">
            {t.address}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (t) => <StatusBadge value={t.locatorStatus} />,
    },
    {
      key: "type",
      header: "Type",
      render: (t) => <StatusBadge value={t.ticketType} />,
    },
    {
      key: "time",
      header: "Time",
      align: "right",
      render: (t) => (
        <span className="tabular-nums">
          {formatDuration(t.timeAllocation?.totalMs ?? 0)}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      align: "right",
      render: (t) => (
        <span className="text-xs text-gray-500">
          {new Date(t.updatedAt).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={tech?.name || "Technician"}
        subtitle={
          <Link
            to="/techs"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to technicians
          </Link>
        }
        actions={<RangeToggle value={range} onChange={setRange} />}
      />

      {techQuery.isLoading || !tech ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Sub Areas
              </div>
              <div className="text-sm font-medium text-gray-900">
                {tech.assignedTerritories && tech.assignedTerritories.length > 0
                  ? tech.assignedTerritories.map((t) => t.name).join(", ")
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Supervisor
              </div>
              <div className="text-sm font-medium text-gray-900">
                {tech.supervisorName || "—"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Clock
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge value={tech.clockStatus} />
                {tech.currentSession && (
                  <span className="text-sm font-medium text-gray-900 tabular-nums">
                    {formatDuration(now - tech.currentSession.clockInAt)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1" />
            {tech.currentTicket && (
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Current Ticket
                </div>
                <div className="font-medium text-gray-900">
                  {tech.currentTicket.ticketNumber}{" "}
                  <StatusBadge value={tech.currentTicket.locatorStatus} />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <Metric
              label="On Board"
              value={tech.productivity.ticketsOnBoard}
              icon={<ChartBarSquareIcon className="h-6 w-6" />}
            />
            <Metric
              label="Closed (range)"
              value={tech.productivity.ticketsClosedInRange}
              hint={`${tech.productivity.ticketsTotalClosed} all-time`}
              icon={<CheckCircleIcon className="h-6 w-6" />}
              accent="green"
            />
            <Metric
              label="Locates"
              value={tech.productivity.locatesClosed}
              icon={<BanknotesIcon className="h-6 w-6" />}
              accent="purple"
            />
            <Metric
              label="Footage"
              value={tech.productivity.footage.toLocaleString()}
              hint="feet"
              icon={<MapIcon className="h-6 w-6" />}
              accent="blue"
            />
            <Metric
              label="LPH · FPH"
              value={`${tech.productivity.lph.toFixed(1)} · ${Math.round(tech.productivity.fph)}`}
              icon={<ChartBarSquareIcon className="h-6 w-6" />}
            />
            <Metric
              label="Productive"
              value={formatDuration(tech.productivity.productiveMs)}
              hint={`lunch ${formatDuration(tech.productivity.lunchMs)} · personal ${formatDuration(tech.productivity.personalMs)}`}
              icon={<ClockIcon className="h-6 w-6" />}
              accent="yellow"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Tickets in range
                  </h3>
                </div>
                <DataTable
                  columns={ticketColumns}
                  rows={ticketsQuery.data?.tickets}
                  rowKey={(t) => t.id}
                  loading={ticketsQuery.isLoading}
                  empty={{ title: "No tickets touched in this range" }}
                  className="border-none shadow-none rounded-none"
                />
              </div>
            </div>

            <div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Timesheet
                  </h3>
                </div>
                <div className="px-5 py-3 space-y-3">
                  {timesheetQuery.data?.sessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <div>
                        <div className="font-medium text-gray-900">
                          {s.date}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(s.clockInAt).toLocaleTimeString()} →{" "}
                          {s.clockOutAt
                            ? new Date(s.clockOutAt).toLocaleTimeString()
                            : "active"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900 tabular-nums">
                          {formatDuration(s.productiveMs)}
                        </div>
                        <div className="text-xs text-gray-500">
                          L {formatDuration(s.lunchMs)} · P{" "}
                          {formatDuration(s.personalMs)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!timesheetQuery.data ||
                    timesheetQuery.data.sessions.length === 0) && (
                    <div className="text-sm text-gray-500 text-center py-6">
                      No sessions in range.
                    </div>
                  )}
                </div>
                {timesheetQuery.data && (
                  <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-500">
                    Total productive{" "}
                    <span className="font-semibold text-gray-900">
                      {formatDuration(timesheetQuery.data.totals.productiveMs)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
