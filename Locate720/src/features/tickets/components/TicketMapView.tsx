import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Linking, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import Ticket from "../../../db/models/Ticket";
import { colors } from "../../../ui/colors";
import { logger } from "../../../utils/logger";
import { formatDueDateTime } from "../../../utils/date";
import { getDueAccentColorFromTimestamp } from "../domain/dueColor";
import {
  formatTicketType,
  getTicketDisplayData,
} from "../utils/ticketPayload";
import { getScopePolygon } from "../utils/scopeGeometry";
import {
  formatLocatorStatus,
  getLocatorStatusColor,
} from "../utils/ticketPresentation";
import { MapErrorBoundary } from "./MapErrorBoundary";

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const mapModule = (() => {
  try {
    return require("react-native-maps");
  } catch (error) {
    logger.warn("[TicketMapView] react-native-maps native module unavailable:", error);
    return null;
  }
})();

const locationModule = (() => {
  try {
    return require("expo-location");
  } catch (error) {
    logger.warn("[TicketMapView] expo-location native module unavailable:", error);
    return null;
  }
})();

const MapView = mapModule?.default;
const Marker = mapModule?.Marker;
const Polygon = mapModule?.Polygon;
const PROVIDER_GOOGLE = mapModule?.PROVIDER_GOOGLE;

function getInitialRegion(tickets: Ticket[]): Region {
  const mapTickets = tickets.filter(
    (ticket) =>
      typeof ticket.lat === "number" &&
      typeof ticket.lng === "number" &&
      !Number.isNaN(ticket.lat) &&
      !Number.isNaN(ticket.lng) &&
      Number.isFinite(ticket.lat) &&
      Number.isFinite(ticket.lng),
  );

  if (mapTickets.length === 0) {
    return {
      latitude: 32.9312,
      longitude: -96.4597,
      latitudeDelta: 0.12,
      longitudeDelta: 0.12,
    };
  }

  const latitudes = mapTickets.map((ticket) => ticket.lat as number);
  const longitudes = mapTickets.map((ticket) => ticket.lng as number);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.04, (maxLat - minLat) * 1.8),
    longitudeDelta: Math.max(0.04, (maxLng - minLng) * 1.8),
  };
}

function getTicketFocusRegion(ticket: Ticket): Region | null {
  if (typeof ticket.lat !== "number" || typeof ticket.lng !== "number") {
    return null;
  }

  return {
    latitude: ticket.lat,
    longitude: ticket.lng,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };
}

function getScopeBox(ticket: Ticket) {
  return getScopePolygon(ticket.payloadJson, ticket.lat, ticket.lng);
}


type Props = {
  tickets: Ticket[];
  onOpenTicket: (ticketId: string) => void;
  isLoading?: boolean;
};

export function TicketMapView({ tickets, onOpenTicket, isLoading = false }: Props) {
  const mapRef = useRef<any>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [hasDismissedDefaultSelection, setHasDismissedDefaultSelection] =
    useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [userRegion, setUserRegion] = useState<Region | null>(null);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [visibleTicketId, setVisibleTicketId] = useState<string | null>(null);
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(20)).current;

  const mappableTickets = useMemo(
    () =>
      tickets.filter(
        (ticket) =>
          typeof ticket.lat === "number" &&
          typeof ticket.lng === "number" &&
          !Number.isNaN(ticket.lat) &&
          !Number.isNaN(ticket.lng) &&
          Number.isFinite(ticket.lat) &&
          Number.isFinite(ticket.lng),
      ),
    [tickets],
  );

  const scopeCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof getScopePolygon>>();
    for (const ticket of mappableTickets) {
      cache.set(ticket.id, getScopeBox(ticket));
    }
    return cache;
  }, [mappableTickets]);

  const initialRegion = useMemo(
    () => getInitialRegion(mappableTickets),
    [mappableTickets],
  );
  const defaultSelectedTicket = useMemo(
    () =>
      mappableTickets.find((ticket) => ticket.locatorStatus === "ONSITE") ||
      mappableTickets.find((ticket) => ticket.locatorStatus === "ENROUTE") ||
      null,
    [mappableTickets],
  );
  const mapInitialRegion = useMemo(
    () => (defaultSelectedTicket ? getTicketFocusRegion(defaultSelectedTicket) || initialRegion : initialRegion),
    [defaultSelectedTicket, initialRegion],
  );

  const selectedTicket = useMemo(
    () =>
      mappableTickets.find((ticket) => ticket.id === selectedTicketId) || null,
    [mappableTickets, selectedTicketId],
  );
  const visibleTicket = useMemo(
    () =>
      mappableTickets.find((ticket) => ticket.id === visibleTicketId) || null,
    [mappableTickets, visibleTicketId],
  );
  const visibleTicketDisplay = useMemo(
    () => getTicketDisplayData(visibleTicket?.payloadJson),
    [visibleTicket?.payloadJson],
  );

  useEffect(() => {
    if (
      !selectedTicketId &&
      !hasDismissedDefaultSelection &&
      defaultSelectedTicket
    ) {
      setSelectedTicketId(defaultSelectedTicket.id);
    }
  }, [defaultSelectedTicket, hasDismissedDefaultSelection, selectedTicketId]);

  useEffect(() => {
    if (!selectedTicket) {
      Animated.parallel([
        Animated.timing(cardOpacity, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(cardTranslateY, {
          toValue: 20,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setVisibleTicketId(null);
        }
      });
      return;
    }

    setVisibleTicketId(selectedTicket.id);
    cardOpacity.setValue(0);
    cardTranslateY.setValue(20);
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.spring(cardTranslateY, {
        toValue: 0,
        damping: 18,
        stiffness: 180,
        mass: 0.9,
        useNativeDriver: true,
      }),
    ]).start();
  }, [cardOpacity, cardTranslateY, selectedTicket]);

  useEffect(() => {
    let active = true;

    const loadLocation = async () => {
      if (!locationModule) {
        setLocationPermissionDenied(true);
        return;
      }

      try {
        const { status } =
          await locationModule.requestForegroundPermissionsAsync();
        if (!active) return;

        if (status !== "granted") {
          setLocationPermissionDenied(true);
          return;
        }

        const location = await locationModule.getCurrentPositionAsync({
          accuracy: locationModule.Accuracy?.Balanced,
        });
        if (!active) return;

        setUserRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        });
      } catch (error) {
        logger.error("[TicketMapView] Failed to load location:", error);
      }
    };

    loadLocation();

    return () => {
      active = false;
    };
  }, []);

  if (!MapView || !Marker || !Polygon) {
    return (
      <View className="flex-1 px-4 pb-4">
        <View
          className="flex-1 rounded-3xl p-5"
          style={{ backgroundColor: colors.surface }}
        >
          <Text className="text-lg font-bold" style={{ color: colors.text }}>
            Map unavailable in this build
          </Text>
          <Text className="text-sm mt-3" style={{ color: colors.muted }}>
            The current dev client does not include the native map modules yet.
            Rebuild the app with `npx expo run:android` or `npx expo run:ios`
            to enable the live map and location features.
          </Text>
          <Text className="text-sm mt-4" style={{ color: colors.text }}>
            Your ticket list still works, and the scope-box contract can remain
            in progress until the rebuilt client is installed.
          </Text>
        </View>
      </View>
    );
  }

  const handleRecenter = () => {
    const region =
      (selectedTicket && getTicketFocusRegion(selectedTicket)) ||
      userRegion ||
      mapInitialRegion;
    mapRef.current?.animateToRegion(region, 350);
  };

  const focusSelectedTicket = (ticket: Ticket) => {
    if (typeof ticket.lat !== "number" || typeof ticket.lng !== "number") {
      return;
    }

    mapRef.current?.animateToRegion(
      {
        latitude: ticket.lat,
        longitude: ticket.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      300,
    );
  };

  useEffect(() => {
    if (!mapReady || !selectedTicket) {
      return;
    }

    const region = getTicketFocusRegion(selectedTicket);
    if (region) {
      mapRef.current?.animateToRegion(region, 300);
    }
  }, [mapReady, selectedTicket]);

  const handleContractorPhonePress = () => {
    if (!visibleTicketDisplay.contractorPhone) {
      return;
    }

    const cleanPhone = visibleTicketDisplay.contractorPhone.replace(/[^0-9]/g, "");
    if (cleanPhone) {
      Linking.openURL(`tel:${cleanPhone}`);
    }
  };

  return (
    <View className="flex-1 px-4 pb-4">
      <View
        className="flex-1"
        style={{ backgroundColor: colors.surface }}
      >
        {isLoading ? (
          <View
            className="flex-1 items-center justify-center rounded-3xl"
            style={{ backgroundColor: colors.surface }}
          >
            <ActivityIndicator size="large" color={colors.accent} />
            <Text className="text-sm mt-3" style={{ color: colors.muted }}>
              Loading tickets...
            </Text>
          </View>
        ) : (
        <View
          className="flex-1 overflow-hidden rounded-3xl"
          style={{ backgroundColor: colors.surface }}
        >
          <MapErrorBoundary>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            provider={PROVIDER_GOOGLE}
            initialRegion={userRegion || mapInitialRegion}
            showsUserLocation
            showsMyLocationButton={false}
            onMapReady={() => {
              setMapReady(true);
              const preferredRegion =
                (selectedTicket && getTicketFocusRegion(selectedTicket)) ||
                userRegion ||
                mapInitialRegion;
              if (preferredRegion) {
                mapRef.current?.animateToRegion(preferredRegion, 350);
              }
            }}
            onPress={() => {
              setSelectedTicketId(null);
              setHasDismissedDefaultSelection(true);
            }}
          >
            {mappableTickets.map((ticket) => {
              const scopeBox = scopeCache.get(ticket.id) ?? null;

              return (
                <Fragment key={ticket.id}>
                  {scopeBox ? (
                    <Polygon
                      key={`${ticket.id}-scope`}
                      coordinates={scopeBox}
                      fillColor={`${getDueAccentColorFromTimestamp(ticket.dueAt)}22`}
                      strokeColor={getDueAccentColorFromTimestamp(ticket.dueAt)}
                      strokeWidth={2}
                    />
                  ) : null}
                  <Marker
                    key={`${ticket.id}-marker`}
                    coordinate={{
                      latitude: ticket.lat as number,
                      longitude: ticket.lng as number,
                    }}
                    pinColor={getDueAccentColorFromTimestamp(ticket.dueAt)}
                    onSelect={() => {
                      setSelectedTicketId(ticket.id);
                      setHasDismissedDefaultSelection(false);
                      focusSelectedTicket(ticket);
                    }}
                  />
                </Fragment>
              );
            })}
          </MapView>
          </MapErrorBoundary>

          <Pressable
            onPress={handleRecenter}
            className="absolute top-4 right-4 w-12 h-12 rounded-2xl items-center justify-center"
            style={{ backgroundColor: colors.bg }}
          >
            <Ionicons name="locate" size={20} color={colors.text} />
          </Pressable>

          {!mapReady || mappableTickets.length === 0 || locationPermissionDenied ? (
            <View
              className="absolute top-4 left-4 right-20 rounded-2xl px-4 py-3"
              style={{ backgroundColor: `${colors.bg}E6` }}
            >
              {mappableTickets.length === 0 ? (
                <>
                  <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                    No tickets with coordinates to display
                  </Text>
                  <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                    Tickets without coordinates will stay in the list until map data is available.
                  </Text>
                </>
              ) : locationPermissionDenied ? (
                <>
                  <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                    Location permission not granted
                  </Text>
                  <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                    Ticket pins still work. Your live location indicator will appear after permission is allowed.
                  </Text>
                </>
              ) : (
                <>
                  <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                    Loading map
                  </Text>
                  <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                    Pulling your current position and ticket coverage area.
                  </Text>
                </>
              )}
            </View>
          ) : null}
        </View>
        )}

        {visibleTicket ? (
          <Animated.View
            style={{
              opacity: cardOpacity,
              transform: [{ translateY: cardTranslateY }],
            }}
          >
            <Pressable
            onPress={() => onOpenTicket(visibleTicket.id)}
            className="mt-3 rounded-[28px] px-5 pt-3 pb-5"
            style={{
              backgroundColor: colors.bg,
              borderWidth: 1,
              borderColor: `${getDueAccentColorFromTimestamp(visibleTicket.dueAt)}55`,
            }}
          >
            <View className="items-center pb-3">
              <View
                className="h-1.5 w-14 rounded-full"
                style={{ backgroundColor: `${colors.muted}66` }}
              />
            </View>

            <View className="flex-row items-start justify-between">
              <View className="flex-1 pr-3">
                <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
                  <Text className="text-lg font-bold" style={{ color: colors.text }}>
                    {visibleTicket.ticketNumber}
                  </Text>
                  <View
                    className="px-3 py-1 rounded-full"
                    style={{
                      backgroundColor: `${getDueAccentColorFromTimestamp(visibleTicket.dueAt)}22`,
                      borderWidth: 1,
                      borderColor: `${getDueAccentColorFromTimestamp(visibleTicket.dueAt)}66`,
                    }}
                  >
                    <Text
                      className="text-[11px] font-semibold"
                      style={{ color: getDueAccentColorFromTimestamp(visibleTicket.dueAt) }}
                    >
                      {formatDueDateTime(visibleTicket.dueAt)}
                    </Text>
                  </View>
                </View>

                <Text className="text-sm mt-3" style={{ color: colors.text }} numberOfLines={2}>
                  {visibleTicket.address}
                </Text>

                <View className="flex-row items-center flex-wrap mt-3" style={{ gap: 8 }}>
                  <View
                    className="px-3 py-1 rounded-full"
                    style={{ backgroundColor: `${colors.surface}CC` }}
                  >
                    <Text className="text-[11px] font-semibold" style={{ color: colors.text }}>
                      {formatTicketType(visibleTicket.ticketType)}
                    </Text>
                  </View>
                  <View
                    className="px-3 py-1 rounded-full"
                    style={{ backgroundColor: getLocatorStatusColor(visibleTicket.locatorStatus) }}
                  >
                    <Text className="text-[11px] font-semibold" style={{ color: colors.bg }}>
                      {formatLocatorStatus(visibleTicket.locatorStatus)}
                    </Text>
                  </View>
                </View>

                {visibleTicketDisplay.workType ? (
                  <View className="mt-4">
                    <Text className="text-[11px] uppercase tracking-widest" style={{ color: colors.muted }}>
                      Work Type
                    </Text>
                    <Text className="text-sm mt-1 font-semibold" style={{ color: colors.text }}>
                      {visibleTicketDisplay.workType}
                    </Text>
                  </View>
                ) : null}

                <View className="mt-4">
                  <Text className="text-[11px] uppercase tracking-widest" style={{ color: colors.muted }}>
                    Contractor
                  </Text>
                  <Text className="text-sm mt-1 font-semibold" style={{ color: colors.text }}>
                    {visibleTicketDisplay.contractor || "No contractor listed"}
                  </Text>
                  {visibleTicketDisplay.contractorPhone ? (
                    <Pressable onPress={handleContractorPhonePress} className="mt-2 self-start">
                      <View className="flex-row items-center">
                        <Ionicons name="call" size={12} color={colors.accent} />
                        <Text className="text-xs ml-1" style={{ color: colors.accent }}>
                          {visibleTicketDisplay.contractorPhone}
                        </Text>
                      </View>
                    </Pressable>
                  ) : null}
                </View>

                <Text className="text-xs mt-3" style={{ color: colors.muted }}>
                  Due{" "}
                  {visibleTicket.dueAt
                    ? new Date(visibleTicket.dueAt).toLocaleString()
                    : "Unscheduled"}
                </Text>
              </View>

              <View className="items-end justify-between self-stretch">
                <View
                  className="w-11 h-11 rounded-2xl items-center justify-center"
                  style={{ backgroundColor: `${colors.surface}CC` }}
                >
                  <Ionicons
                    name="document-text-outline"
                    size={20}
                    color={colors.accent}
                  />
                </View>
              </View>
            </View>

            <View
              className="flex-row items-center justify-between mt-4 pt-4"
              style={{ borderTopWidth: 1, borderTopColor: `${colors.muted}22` }}
            >
              <Text className="text-xs" style={{ color: colors.muted }}>
                Tap for full ticket details
              </Text>
              <View className="flex-row items-center">
                <Text className="text-sm font-semibold" style={{ color: colors.accent }}>
                  Open Ticket
                </Text>
                <Ionicons name="arrow-forward" size={16} color={colors.accent} style={{ marginLeft: 6 }} />
              </View>
            </View>
          </Pressable>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}
