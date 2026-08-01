import type { ActivityRow } from "../../types/ops";
import { formatDistanceToNow } from "date-fns";

interface Props {
  events: ActivityRow[] | undefined;
  loading?: boolean;
}

function summarize(e: ActivityRow): string {
  if (e.type === "OPS_ASSIGN") return e.notes || "Ticket reassigned";
  if (e.type === "OPS_STATUS") {
    return `Status → ${e.newLocatorStatus || e.newStatus || "updated"}`;
  }
  if (e.newLocatorStatus && e.oldLocatorStatus) {
    return `${e.oldLocatorStatus} → ${e.newLocatorStatus}`;
  }
  if (e.newStatus && e.oldStatus) {
    return `${e.oldStatus} → ${e.newStatus}`;
  }
  return e.type.replace(/_/g, " ");
}

export function ActivityFeed({ events, loading }: Props) {
  if (loading) {
    return <div className="text-sm text-gray-500 py-6">Loading activity…</div>;
  }
  if (!events || events.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center">
        No recent activity.
      </div>
    );
  }
  return (
    <ol className="divide-y divide-gray-100">
      {events.map((e) => (
        <li key={e.id} className="py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-gray-900 truncate">
                <span className="font-medium">{e.ticketNumber || "—"}</span>
                <span className="text-gray-500"> · {summarize(e)}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {e.userName || "System"}
              </div>
            </div>
            <div className="text-xs text-gray-400 shrink-0">
              {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
