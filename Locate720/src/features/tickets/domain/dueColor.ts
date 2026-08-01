import type { Ticket } from "../types";

type DueColor = {
  color: string;
};

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDaysLocal(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0);
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Returns an accent color for a ticket card based on its due time.
 */
export function getTicketDueAccent(ticket: Ticket, now: Date = new Date()): DueColor {
  const due = new Date(ticket.dueAt);
  if (Number.isNaN(due.getTime())) return { color: "#0B5CAD" };

  const diffMs = due.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  // Overdue (late) -> dark red
  if (diffHours < 0) return { color: "#E74C3C" };

  // Due within 2 hours -> orangish
  if (diffHours <= 2) return { color: "#F5A623" };

  const todayStart = startOfLocalDay(now);
  const tomorrowStart = addDaysLocal(todayStart, 1);
  const dayAfterTomorrowStart = addDaysLocal(todayStart, 2);

  // Due today -> yellow
  if (isSameLocalDay(due, now)) return { color: "#F1C40F" };

  // Due tomorrow
  if (due >= tomorrowStart && due < dayAfterTomorrowStart) {
    const hour = due.getHours();
    // Tomorrow morning (before noon) -> dark green
    if (hour < 12) return { color: "#1F8A3B" };
    // Tomorrow evening (noon+) -> light green
    return { color: "#2ECC71" };
  }

  // Due 2 days out -> light blue
  const twoDaysStart = dayAfterTomorrowStart;
  const threeDaysStart = addDaysLocal(todayStart, 3);
  if (due >= twoDaysStart && due < threeDaysStart) return { color: "#5DADE2" };

  return { color: "#0B5CAD" };
}

export function getDueAccentColorFromTimestamp(
  dueAt?: number,
  nowMs: number = Date.now(),
): string {
  if (!dueAt) return "#A7B0C2";

  const diffHours = (dueAt - nowMs) / (1000 * 60 * 60);

  if (diffHours < 0) return "#E5484D";
  if (diffHours < 2) return "#FF6F00";
  if (diffHours < 24) return "#FFA726";
  if (diffHours < 72) return "#3498DB";
  return "#0B5CAD";
}
