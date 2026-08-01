import { useQuery } from "@tanstack/react-query";
import {
  UserGroupIcon,
  ClipboardDocumentListIcon,
  CheckCircleIcon,
  ChartBarSquareIcon,
  ClockIcon,
  MapIcon,
} from "@heroicons/react/24/outline";
import { OpsService } from "../../services/opsService";
import { useRange } from "../../hooks/useRange";
import {
  Metric,
  PageHeader,
  RangeToggle,
  Spinner,
  formatDuration,
} from "../../components/ui";
import { LiveTechBoard } from "../../components/features/LiveTechBoard";
import { ActivityFeed } from "../../components/features/ActivityFeed";

export function DashboardPage() {
  const { state, setRange, toQuery, queryKey } = useRange("day");

  const statsQuery = useQuery({
    queryKey: ["ops", "dashboard", "stats", queryKey],
    queryFn: () => OpsService.getDashboardStats(toQuery()),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const techStatusQuery = useQuery({
    queryKey: ["ops", "dashboard", "tech-status"],
    queryFn: () => OpsService.getTechStatus(),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const activityQuery = useQuery({
    queryKey: ["ops", "activity", 50],
    queryFn: () => OpsService.getActivity(50),
    refetchInterval: 60000,
  });

  const customerQuery = useQuery({
    queryKey: ["ops", "customers", queryKey],
    queryFn: () => OpsService.getCustomerSummary(toQuery()),
    refetchInterval: 60000,
  });

  const stats = statsQuery.data;
  const totalFootage = stats?.production.footageInRange ?? 0;
  const locatesClosed = stats?.production.locatesClosedInRange ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={stats ? stats.range.label : "Live operations overview"}
        actions={<RangeToggle value={state} onChange={setRange} />}
      />

      {statsQuery.isLoading && !stats ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <Metric
              label="Clocked In"
              value={stats?.techs.clockedIn ?? 0}
              hint={`${stats?.techs.total ?? 0} total techs`}
              icon={<UserGroupIcon className="h-6 w-6" />}
              accent="green"
            />
            <Metric
              label="On Break"
              value={(stats?.techs.onLunch ?? 0) + (stats?.techs.onPersonal ?? 0)}
              hint={`${stats?.techs.onLunch ?? 0} lunch · ${stats?.techs.onPersonal ?? 0} personal`}
              icon={<ClockIcon className="h-6 w-6" />}
              accent="yellow"
            />
            <Metric
              label="Open Tickets"
              value={
                (stats?.tickets.byLocatorStatus.ASSIGNED ?? 0) +
                (stats?.tickets.byLocatorStatus.ENROUTE ?? 0) +
                (stats?.tickets.byLocatorStatus.ONSITE ?? 0) +
                (stats?.tickets.byLocatorStatus.PAUSED ?? 0)
              }
              hint={`${stats?.tickets.unassigned ?? 0} unassigned`}
              icon={<ClipboardDocumentListIcon className="h-6 w-6" />}
              accent="blue"
            />
            <Metric
              label="Closed (range)"
              value={stats?.tickets.closedInRange ?? 0}
              hint={`${locatesClosed} locates closed`}
              icon={<CheckCircleIcon className="h-6 w-6" />}
              accent="gray"
            />
            <Metric
              label="Footage (range)"
              value={totalFootage.toLocaleString()}
              hint="feet located"
              icon={<MapIcon className="h-6 w-6" />}
              accent="purple"
            />
            <Metric
              label="Avg LPH / FPH"
              value={`${(stats?.production.avgLph ?? 0).toFixed(1)} · ${Math.round(
                stats?.production.avgFph ?? 0,
              )}`}
              hint="locates / footage per hour"
              icon={<ChartBarSquareIcon className="h-6 w-6" />}
              accent="blue"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Live Tech Board
                  </h3>
                  <span className="text-xs text-gray-400">auto-refresh · live</span>
                </div>
                <div className="px-5">
                  <LiveTechBoard techs={techStatusQuery.data} />
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Recent Activity
                  </h3>
                </div>
                <div className="px-5 py-3">
                  <ActivityFeed
                    events={activityQuery.data}
                    loading={activityQuery.isLoading}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Areas
                  </h3>
                </div>
                <div className="px-5 py-3 space-y-3">
                  {(stats?.areas || []).map((area) => (
                    <div
                      key={area.areaId}
                      className="flex items-center justify-between"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {area.areaId.replace(/_/g, " ")}
                        </div>
                        <div className="text-xs text-gray-500">
                          {area.techs} tech{area.techs === 1 ? "" : "s"} ·{" "}
                          {area.openTickets} open
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900">
                          {area.closedInRange}
                        </div>
                        <div className="text-xs text-gray-400">closed</div>
                      </div>
                    </div>
                  ))}
                  {(!stats?.areas || stats.areas.length === 0) && (
                    <div className="text-sm text-gray-500 text-center py-4">
                      No area data
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Top Customers ({stats?.range.label ?? ""})
                  </h3>
                </div>
                <div className="px-5 py-3">
                  {(customerQuery.data?.customers || []).slice(0, 5).map((c) => (
                    <div
                      key={`${c.customerName}-${c.utilityType}`}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {c.customerName || "—"}
                        </div>
                        <div className="text-xs text-gray-500">
                          {c.utilityType} · {c.ticketCount} tickets ·{" "}
                          {formatDuration(c.minutes * 60000, true)}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-gray-900 tabular-nums">
                        {c.footage.toLocaleString()} ft
                      </div>
                    </div>
                  ))}
                  {(!customerQuery.data?.customers ||
                    customerQuery.data.customers.length === 0) && (
                    <div className="text-sm text-gray-500 text-center py-4">
                      No production data in range.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
