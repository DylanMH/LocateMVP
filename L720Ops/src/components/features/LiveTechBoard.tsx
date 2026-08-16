import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { TechStatusRow } from "../../types/ops";
import { StatusBadge, formatDuration } from "../ui";

function allocationLabel(v: string | null | undefined): string {
  if (!v) return "";
  const labels: Record<string, string> = {
    locating: "Locating",
    training: "Training",
    truck_support: "Truck Support",
    meeting: "Meeting",
    oncall: "On Call",
    other: "Other",
  };
  return labels[v] || v.replace(/_/g, " ");
}

interface Props {
  techs: TechStatusRow[] | undefined;
}

export function LiveTechBoard({ techs }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const working = (techs || []).filter((t) => t.clockStatus !== "CLOCKED_OUT");

  if (working.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-8 text-center">
        No technicians currently clocked in.
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {working.map((tech) => {
        const clockedFor = tech.currentSession
          ? now - tech.currentSession.clockInAt
          : 0;

        // Prefer currentTicket from session (set by backend), fall back to top-level.
        const activeTicket =
          tech.currentSession?.currentTicket || tech.currentTicket || null;
        const clockOutTicket = tech.currentSession?.clockOutTicket || null;

        const onsiteFor = activeTicket?.onsiteStartedAt
          ? now - activeTicket.onsiteStartedAt
          : null;

        return (
          <div
            key={tech.id}
            className="flex items-center justify-between py-3 gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  to={`/techs/${tech.id}`}
                  className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate"
                >
                  {tech.name}
                </Link>
                <StatusBadge value={tech.clockStatus} />
                {tech.currentSession?.allocationType && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                    {allocationLabel(tech.currentSession.allocationType)}
                  </span>
                )}
                {tech.assignedTerritories && tech.assignedTerritories.length > 0 && (
                  <span className="text-xs text-gray-400">
                    {tech.assignedTerritories.map((t) => t.name).join(", ")}
                  </span>
                )}
              </div>

              {/* Current ticket or clock-out ticket info */}
              {activeTicket ? (
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {activeTicket.ticketNumber}
                  <span className="mx-1">·</span>
                  <StatusBadge value={activeTicket.locatorStatus} />
                  {onsiteFor != null && (
                    <span className="ml-2 text-gray-500">
                      onsite {formatDuration(onsiteFor)}
                    </span>
                  )}
                </div>
              ) : clockOutTicket ? (
                <div className="text-xs text-gray-400 mt-0.5">
                  Clocked out on {clockOutTicket.ticketNumber}
                </div>
              ) : (
                <div className="text-xs text-gray-400 mt-0.5">
                  No active ticket
                </div>
              )}

              {/* Clock-in reason subtitle */}
              {tech.currentSession?.clockInReason && (
                <div className="text-xs text-gray-400 mt-0.5">
                  {allocationLabel(tech.currentSession.clockInReason)}
                  {tech.currentSession.otherReason && (
                    <span className="italic">
                      {" "}
                      — &ldquo;{tech.currentSession.otherReason}&rdquo;
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="text-right shrink-0">
              <div className="text-sm font-medium text-gray-900 tabular-nums">
                {formatDuration(clockedFor)}
              </div>
              <div className="text-xs text-gray-400">clocked</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
