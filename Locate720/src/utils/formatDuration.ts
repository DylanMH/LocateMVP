/**
 * Format milliseconds as a compact duration string.
 * @param millis - duration in milliseconds
 * @param options.includeSeconds - if true, include seconds in output (default false)
 * @returns e.g. "1h 1m" or "1h 1m 1s"
 */
export function formatDuration(millis: number, options?: { includeSeconds?: boolean }): string {
  if (!Number.isFinite(millis) || millis < 0) {
    millis = 0;
  }

  const totalSeconds = Math.floor(millis / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const includeSeconds = options?.includeSeconds ?? false;

  if (hours > 0) {
    return includeSeconds
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return includeSeconds
      ? `${minutes}m ${seconds}s`
      : `${minutes}m`;
  }

  return includeSeconds ? `0m ${seconds}s` : '0m';
}
