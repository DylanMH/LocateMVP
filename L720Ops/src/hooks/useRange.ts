import { useSearchParams } from "react-router-dom";
import { useCallback, useMemo } from "react";

export type RangeKey = "day" | "week" | "month" | "all" | "custom";

export interface RangeState {
  range: RangeKey;
  startDate?: string;
  endDate?: string;
}

export type RangeQuery = Record<string, string | undefined>;

/**
 * Single source of truth for the selected time window, persisted in the URL
 * (`?range=day|week|month|all` or `?startDate&endDate`). Every analytics
 * query on the page should include `toQuery()` in its query key and request
 * params so a range change invalidates them together.
 */
export function useRange(defaultRange: RangeKey = "day") {
  const [searchParams, setSearchParams] = useSearchParams();

  const state: RangeState = useMemo(() => {
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    if (startDate || endDate) {
      return { range: "custom", startDate, endDate };
    }
    const range = (searchParams.get("range") as RangeKey | null) || defaultRange;
    return { range };
  }, [searchParams, defaultRange]);

  const setRange = useCallback(
    (next: RangeState) => {
      const params = new URLSearchParams(searchParams);
      params.delete("range");
      params.delete("startDate");
      params.delete("endDate");
      if (next.range === "custom") {
        if (next.startDate) params.set("startDate", next.startDate);
        if (next.endDate) params.set("endDate", next.endDate);
      } else if (next.range !== defaultRange) {
        params.set("range", next.range);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams, defaultRange],
  );

  const toQuery = useCallback((): RangeQuery => {
    if (state.range === "custom") {
      return { startDate: state.startDate, endDate: state.endDate };
    }
    return { range: state.range };
  }, [state]);

  const queryKey = useMemo(
    () => [state.range, state.startDate, state.endDate] as const,
    [state],
  );

  return { state, setRange, toQuery, queryKey };
}
