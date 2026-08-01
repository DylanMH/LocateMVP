import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { TechStatusRow } from "../../types/ops";
import { StatusBadge, formatDuration } from "../ui";

interface Props {
  techs: TechStatusRow[] | undefined;
}

export function LiveTechBoard({ techs }: Props) {
  // client-side ticking so elapsed timers stay live without re-fetching
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
        const onsiteFor = tech.currentTicket?.onsiteStartedAt
          ? now - tech.currentTicket.onsiteStartedAt
          : null;
        return (
          <div
            key={tech.id}
            className="flex items-center justify-between py-3 gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  to={`/techs/${tech.id}`}
                  className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate"
                >
                  {tech.name}
                </Link>
                <StatusBadge value={tech.clockStatus} />
                {tech.areaId && (
                  <span className="text-xs text-gray-400">{tech.areaId}</span>
                )}
              </div>
              {tech.currentTicket ? (
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {tech.currentTicket.ticketNumber}
                  <span className="mx-1">·</span>
                  <StatusBadge value={tech.currentTicket.locatorStatus} />
                  {onsiteFor != null && (
                    <span className="ml-2 text-gray-500">
                      onsite {formatDuration(onsiteFor)}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-gray-400 mt-0.5">
                  No active ticket
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
