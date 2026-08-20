import { Fragment, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../src/features/auth/AuthContext";
import {
  fetchOpsMap,
  type OpsMapMarker,
  type DueUrgency,
  DUE_URGENCY_COLORS,
  DUE_URGENCY_LABELS,
} from "../../../src/features/ops/api/opsApiClient";
import { colors } from "../../../src/ui/colors";
import { logger } from "../../../src/utils/logger";
import { MapErrorBoundary } from "../../../src/features/tickets/components/MapErrorBoundary";

type MapFilter = "all" | "OVERDUE" | "DUE_WITHIN_2_HOURS" | "DUE_TODAY" | "active";

const FILTERS: { label: string; value: MapFilter }[] = [
  { label: "All", value: "all" },
  { label: "Overdue", value: "OVERDUE" },
  { label: "Due < 2h", value: "DUE_WITHIN_2_HOURS" },
  { label: "Due Today", value: "DUE_TODAY" },
  { label: "Active Only", value: "active" },
];

const mapModule = (() => {
  try {
    return require("react-native-maps");
  } catch (error) {
    logger.warn("[ManagerMap] react-native-maps native module unavailable:", error);
    return null;
  }
})();

const MapView = mapModule?.default;
const Marker = mapModule?.Marker;
const Callout = mapModule?.Callout;
const PROVIDER_GOOGLE = mapModule?.PROVIDER_GOOGLE;

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

function getMarkerColor(marker: OpsMapMarker): string {
  if (marker.dueUrgency && DUE_URGENCY_COLORS[marker.dueUrgency]) {
    return DUE_URGENCY_COLORS[marker.dueUrgency];
  }
  return colors.muted;
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      className="px-4 py-2 rounded-full"
      style={{ backgroundColor: selected ? colors.primary : colors.surface }}
    >
      <Text className="text-xs font-semibold" style={{ color: colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ManagerMapScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const [markers, setMarkers] = useState<OpsMapMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MapFilter>("all");

  const loadMap = useCallback(
    async (isRefresh = false) => {
      if (!token) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const filters: { dueUrgency?: DueUrgency; active?: boolean } = {};
        if (filter === "OVERDUE") filters.dueUrgency = "OVERDUE";
        else if (filter === "DUE_WITHIN_2_HOURS")
          filters.dueUrgency = "DUE_WITHIN_2_HOURS";
        else if (filter === "DUE_TODAY") filters.dueUrgency = "DUE_TODAY";
        else if (filter === "active") filters.active = true;

        const data = await fetchOpsMap(token, filters);
        setMarkers(data.markers);
      } catch (e) {
        logger.error("[ManagerMap] Failed to load:", e);
        setError(e instanceof Error ? e.message : "Failed to load map");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, filter],
  );

  useFocusEffect(
    useCallback(() => {
      loadMap();
    }, [loadMap]),
  );

  const handleRefresh = () => loadMap(true);

  const initialRegion = useMemo<Region>(() => {
    if (markers.length === 0) {
      return {
        latitude: 32.9312,
        longitude: -96.4597,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      };
    }
    const lats = markers.map((m) => m.lat);
    const lngs = markers.map((m) => m.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.1, (maxLat - minLat) * 1.8),
      longitudeDelta: Math.max(0.1, (maxLng - minLng) * 1.8),
    };
  }, [markers]);

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text className="text-sm mt-3" style={{ color: colors.muted }}>
          Loading map...
        </Text>
      </View>
    );
  }

  if (error && markers.length === 0) {
    return (
      <View
        className="flex-1 items-center justify-center px-5"
        style={{ backgroundColor: colors.bg }}
      >
        <Ionicons name="cloud-offline" size={48} color={colors.danger} />
        <Text
          className="text-base font-semibold mt-4"
          style={{ color: colors.text }}
        >
          Failed to load map
        </Text>
        <Text className="text-sm mt-2 text-center" style={{ color: colors.muted }}>
          {error}
        </Text>
        <Pressable
          onPress={() => loadMap()}
          className="mt-4 rounded-xl px-5 py-3"
          style={{ backgroundColor: colors.primary }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.text }}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!MapView || !Marker || !Callout) {
    return (
      <View
        className="flex-1 items-center justify-center px-5"
        style={{ backgroundColor: colors.bg }}
      >
        <Ionicons name="map" size={48} color={colors.muted} />
        <Text
          className="text-base font-semibold mt-4"
          style={{ color: colors.text }}
        >
          Map unavailable in this build
        </Text>
        <Text className="text-sm mt-2 text-center" style={{ color: colors.muted }}>
          Rebuild the app with `npx expo run:android` or `npx expo run:ios` to
          enable the live map.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      {/* Filter chips + refresh button */}
      <View className="px-4 pt-3 pb-2">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View className="flex-1 flex-row flex-wrap" style={{ gap: 8 }}>
            {FILTERS.map((f) => (
              <Chip
                key={f.value}
                label={f.label}
                selected={filter === f.value}
                onPress={() => setFilter(f.value)}
              />
            ))}
          </View>
          <Pressable
            onPress={handleRefresh}
            hitSlop={10}
            className="px-3 py-2 rounded-full"
            style={{ backgroundColor: colors.surface }}
          >
            <Ionicons name="refresh" size={18} color={colors.accent} />
          </Pressable>
        </View>
      </View>

      {error ? (
        <View
          className="rounded-xl p-3 mx-4 mb-2"
          style={{ backgroundColor: colors.danger + "15" }}
        >
          <Text className="text-sm" style={{ color: colors.danger }}>
            {error}
          </Text>
        </View>
      ) : null}

      <View
        className="flex-1 mx-4 mb-4 overflow-hidden rounded-3xl"
        style={{ backgroundColor: colors.surface }}
      >
        <MapErrorBoundary>
          {markers.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <Ionicons name="map-outline" size={48} color={colors.muted} />
              <Text
                className="text-base font-semibold mt-4"
                style={{ color: colors.text }}
              >
                No markers to display
              </Text>
              <Text
                className="text-sm mt-2 text-center"
                style={{ color: colors.muted }}
              >
                Try adjusting filters.
              </Text>
            </View>
          ) : (
            <MapView
                  style={{ flex: 1, minHeight: 400 }}
                  provider={PROVIDER_GOOGLE}
                  initialRegion={initialRegion}
                  showsUserLocation
                >
                  {markers.map((marker) => (
                    <Fragment key={marker.id}>
                      <Marker
                        coordinate={{
                          latitude: marker.lat,
                          longitude: marker.lng,
                        }}
                        pinColor={getMarkerColor(marker)}
                      >
                        <Callout
                          onPress={() =>
                            router.push({
                              pathname: "/(manager)/ops-ticket/[id]",
                              params: { id: marker.id },
                            })
                          }
                        >
                          <View style={{ maxWidth: 220 }}>
                            <Text
                              style={{
                                fontWeight: "bold",
                                fontSize: 13,
                                color: "#0B1220",
                              }}
                            >
                              {marker.ticketNumber}
                            </Text>
                            <Text
                              style={{ fontSize: 11, color: "#555", marginTop: 2 }}
                            >
                              Status: {marker.locatorStatus}
                            </Text>
                            {marker.assignedTechName ? (
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: "#555",
                                  marginTop: 2,
                                }}
                              >
                                Tech: {marker.assignedTechName}
                              </Text>
                            ) : null}
                            {marker.dueUrgency ? (
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: getMarkerColor(marker),
                                  marginTop: 2,
                                  fontWeight: "600",
                                }}
                              >
                                {DUE_URGENCY_LABELS[marker.dueUrgency]}
                              </Text>
                            ) : null}
                          </View>
                        </Callout>
                      </Marker>
                    </Fragment>
                  ))}
                </MapView>
              )}
        </MapErrorBoundary>
      </View>
    </View>
  );
}
