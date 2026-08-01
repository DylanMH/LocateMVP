/**
 * Uniform range resolution for all /ops aggregate endpoints.
 *
 * Accepts (in priority order):
 *   - startDate / endDate (ISO YYYY-MM-DD) → inclusive calendar days
 *   - range=day|week|month|all             → calendar-aligned presets
 * Returns { startMs, endMs, label, rangeKey } where:
 *   - endMs is always "now" for presets, or end-of-day for explicit endDate
 *   - startMs is 0 for "all"
 *   - label is a human-readable string for logs / CSV headers
 */

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

function startOfIsoWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun .. 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back up to Monday
  x.setDate(x.getDate() + diff);
  return x.getTime();
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x.getTime();
}

export function resolveRange(req) {
  const { range, startDate, endDate } = req.query || {};
  const now = Date.now();

  if (startDate || endDate) {
    const startMs = startDate ? startOfDay(startDate) : 0;
    const endMs = endDate ? endOfDay(endDate) : now;
    return {
      startMs,
      endMs,
      label: `${startDate || "ALL"} → ${endDate || "NOW"}`,
      rangeKey: "custom",
    };
  }

  const key = (range || "day").toLowerCase();
  switch (key) {
    case "all":
      return { startMs: 0, endMs: now, label: "All time", rangeKey: "all" };
    case "month":
      return {
        startMs: startOfMonth(now),
        endMs: now,
        label: "This month",
        rangeKey: "month",
      };
    case "week":
      return {
        startMs: startOfIsoWeek(now),
        endMs: now,
        label: "This week",
        rangeKey: "week",
      };
    case "day":
    default:
      return {
        startMs: startOfDay(now),
        endMs: now,
        label: "Today",
        rangeKey: "day",
      };
  }
}

export function rangeToDateString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
