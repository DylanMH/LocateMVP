/**
 * TicketSelectorModal - Modal for selecting first ticket worked on End Day clock out
 * Only shown when ending the work day, not for lunch or personal time
 *
 * Redesigned with a compact list view + map view tabs so the tech can
 * visually pick the ticket they worked on.  A "No Ticket" option is
 * provided for techs who clock out without a specific ticket, and a
 * prominent Cancel button aborts the entire clock-out operation.
 */

import { useState, useEffect, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Q } from "@nozbe/watermelondb";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { database } from "../../../db/database";
import Ticket from "../../../db/models/Ticket";
import { colors } from "../../../ui/colors";
import { spacing } from "../../../ui/spacing";
import { typography } from "../../../ui/typography";
import { radius } from "../../../ui/radius";
import { logger } from "../../../utils/logger";
import { formatDueDateTime } from "../../../utils/date";
import {
  formatTicketType,
  getTicketDisplayData,
} from "../../tickets/utils/ticketPayload";
import { getTicketTypeColor } from "../../tickets/utils/ticketPresentation";
import { getDueAccentColorFromTimestamp } from "../../tickets/domain/dueColor";
import { MapErrorBoundary } from "../../tickets/components/MapErrorBoundary";

interface TicketSelectorModalProps {
  visible: boolean;
  userId: string;
  onSelect: (ticketId: string | null) => void;
  onCancel: () => void;
}

type Tab = "LIST" | "MAP";

// Lazily load the native map module.  Mirrors the pattern used by
// TicketMapView so the modal degrades gracefully when the native module
// is not present in the current dev client build.
const mapModule = (() => {
  try {
    return require("react-native-maps");
  } catch (error) {
    logger.warn("[TicketSelectorModal] react-native-maps unavailable:", error);
    return null;
  }
})();

const MapView = mapModule?.default;
const Marker = mapModule?.Marker;
const PROVIDER_GOOGLE = mapModule?.PROVIDER_GOOGLE;

type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

function getInitialRegion(tickets: Ticket[]): MapRegion {
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

export function TicketSelectorModal({
  visible,
  userId,
  onSelect,
  onCancel,
}: TicketSelectorModalProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("LIST");

  // Load tickets when modal becomes visible
  useEffect(() => {
    if (!visible || !userId) return;

    const loadTickets = async () => {
      setLoading(true);
      try {
        const ticketsCollection = database.collections.get<Ticket>("tickets");
        const userTickets = await ticketsCollection
          .query(
            Q.where("assigned_tech_id", userId),
            Q.where("status", "OPEN"), // Only show OPEN tickets
            Q.sortBy("due_at", Q.asc),
          )
          .fetch();

        console.log(
          "[TicketSelector] Loaded",
          userTickets.length,
          "open tickets for user",
          userId,
        );
        setTickets(userTickets);
      } catch (error) {
        console.error("[TicketSelector] Failed to load tickets:", error);
      } finally {
        setLoading(false);
      }
    };

    loadTickets();
  }, [visible, userId]);

  // Reset to the list tab each time the modal opens
  useEffect(() => {
    if (visible) {
      setActiveTab("LIST");
    }
  }, [visible]);

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

  const initialRegion = useMemo(
    () => getInitialRegion(mappableTickets),
    [mappableTickets],
  );

  const handleTicketPress = (ticketId: string) => {
    onSelect(ticketId);
  };

  const handleNoTicket = () => {
    onSelect(null);
  };

  const renderCompactTicket = ({ item }: { item: Ticket }) => {
    const dueColor = getDueAccentColorFromTimestamp(item.dueAt);
    const typeColor = getTicketTypeColor(item.ticketType);

    return (
      <Pressable
        onPress={() => handleTicketPress(item.id)}
        style={({ pressed }) => ({
          flexDirection: "row",
          backgroundColor: pressed ? colors.surface : colors.bg,
          borderRadius: radius.cardSm,
          borderWidth: 1,
          borderColor: `${colors.muted}22`,
          overflow: "hidden",
        })}
      >
        {/* Left color bar — due urgency accent */}
        <View
          style={{
            width: 4,
            backgroundColor: dueColor,
          }}
        />

        <View
          style={{
            flex: 1,
            paddingHorizontal: spacing.cardSm,
            paddingVertical: spacing.tight,
          }}
        >
          {/* Top row: ticket number + type badge */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: typography.bodySm,
                fontWeight: typography.weightBold,
                flexShrink: 1,
                marginRight: spacing.sm,
              }}
              numberOfLines={1}
            >
              {item.ticketNumber}
            </Text>
            <View
              style={{
                backgroundColor: typeColor,
                borderRadius: radius.buttonSm,
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: colors.bg,
                  fontSize: typography.captionSm,
                  fontWeight: typography.weightSemibold,
                }}
                numberOfLines={1}
              >
                {formatTicketType(item.ticketType)}
              </Text>
            </View>
          </View>

          {/* Address (truncated) */}
          <Text
            style={{
              color: colors.muted,
              fontSize: typography.metadata,
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {item.address}
          </Text>

          {/* Due time */}
          <Text
            style={{
              color: colors.muted,
              fontSize: typography.caption,
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            Due {formatDueDateTime(item.dueAt)}
          </Text>
        </View>

        {/* Chevron */}
        <View
          style={{
            justifyContent: "center",
            paddingRight: spacing.cardSm,
          }}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </View>
      </Pressable>
    );
  };

  const renderMapTab = () => {
    if (!MapView || !Marker) {
      return (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.section,
          }}
        >
          <Ionicons name="map-outline" size={48} color={colors.muted} />
          <Text
            style={{
              color: colors.text,
              fontSize: typography.bodySm,
              fontWeight: typography.weightSemibold,
              marginTop: spacing.normal,
              textAlign: "center",
            }}
          >
            Map unavailable in this build
          </Text>
          <Text
            style={{
              color: colors.muted,
              fontSize: typography.metadata,
              marginTop: spacing.tight,
              textAlign: "center",
            }}
          >
            The native map module is not included in the current dev client.
            Rebuild with `npx expo run:android` or `npx expo run:ios` to enable
            the map view. Use the List tab to select a ticket.
          </Text>
        </View>
      );
    }

    if (mappableTickets.length === 0) {
      return (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.section,
          }}
        >
          <Ionicons name="location-outline" size={48} color={colors.muted} />
          <Text
            style={{
              color: colors.text,
              fontSize: typography.bodySm,
              fontWeight: typography.weightSemibold,
              marginTop: spacing.normal,
              textAlign: "center",
            }}
          >
            No tickets with coordinates
          </Text>
          <Text
            style={{
              color: colors.muted,
              fontSize: typography.metadata,
              marginTop: spacing.tight,
              textAlign: "center",
            }}
          >
            None of your open tickets have map coordinates. Use the List tab to
            select a ticket.
          </Text>
        </View>
      );
    }

    return (
      <View
        style={{
          flex: 1,
          borderRadius: radius.lg,
          overflow: "hidden",
          backgroundColor: colors.surface,
        }}
      >
        <MapErrorBoundary>
          <MapView
            style={{ flex: 1 }}
            provider={PROVIDER_GOOGLE}
            initialRegion={initialRegion}
            showsUserLocation
            showsMyLocationButton={false}
          >
            {mappableTickets.map((ticket) => (
              <Marker
                key={`${ticket.id}-marker`}
                coordinate={{
                  latitude: ticket.lat as number,
                  longitude: ticket.lng as number,
                }}
                pinColor={getDueAccentColorFromTimestamp(ticket.dueAt)}
                onPress={() => handleTicketPress(ticket.id)}
              />
            ))}
          </MapView>
        </MapErrorBoundary>

        {/* Hint overlay */}
        <View
          style={{
            position: "absolute",
            top: spacing.normal,
            left: spacing.normal,
            right: spacing.normal,
            backgroundColor: `${colors.bg}E6`,
            borderRadius: radius.button,
            paddingHorizontal: spacing.card,
            paddingVertical: spacing.tight,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: typography.metadata,
              fontWeight: typography.weightSemibold,
            }}
          >
            Tap a pin to select that ticket
          </Text>
          <Text
            style={{
              color: colors.muted,
              fontSize: typography.caption,
              marginTop: 2,
            }}
          >
            {mappableTickets.length} ticket
            {mappableTickets.length === 1 ? "" : "s"} on map
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          paddingTop: insets.top,
        }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: spacing.section,
            paddingVertical: spacing.normal,
            borderBottomWidth: 1,
            borderBottomColor: `${colors.muted}22`,
          }}
        >
          <View style={{ flex: 1, marginRight: spacing.normal }}>
            <Text
              style={{
                color: colors.text,
                fontSize: typography.section,
                fontWeight: typography.weightBold,
              }}
            >
              Select Clock-Out Ticket
            </Text>
            <Text
              style={{
                color: colors.muted,
                fontSize: typography.metadata,
                marginTop: 2,
              }}
            >
              Choose the first ticket you worked on today
            </Text>
          </View>

          <Pressable
            onPress={onCancel}
            hitSlop={12}
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.buttonSm,
              backgroundColor: colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>

        {/* Tab bar */}
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: spacing.section,
            paddingTop: spacing.normal,
            gap: spacing.tight,
          }}
        >
          {(["LIST", "MAP"] as Tab[]).map((tab) => {
            const isActive = activeTab === tab;
            return (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: spacing.tight,
                  borderRadius: radius.button,
                  backgroundColor: isActive ? colors.primary : colors.surface,
                  gap: 6,
                }}
              >
                <Ionicons
                  name={tab === "LIST" ? "list" : "map"}
                  size={16}
                  color={isActive ? colors.text : colors.muted}
                />
                <Text
                  style={{
                    color: isActive ? colors.text : colors.muted,
                    fontSize: typography.bodySm,
                    fontWeight: typography.weightSemibold,
                  }}
                >
                  {tab === "LIST" ? "List" : "Map"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Content area */}
        {loading ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator size="large" color={colors.primary} />
            <Text
              style={{
                color: colors.muted,
                fontSize: typography.metadata,
                marginTop: spacing.normal,
              }}
            >
              Loading tickets...
            </Text>
          </View>
        ) : activeTab === "LIST" ? (
          tickets.length === 0 ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: spacing.section,
              }}
            >
              <Ionicons
                name="ticket-outline"
                size={48}
                color={colors.muted}
              />
              <Text
                style={{
                  color: colors.text,
                  fontSize: typography.bodySm,
                  fontWeight: typography.weightSemibold,
                  marginTop: spacing.normal,
                  textAlign: "center",
                }}
              >
                No open tickets available
              </Text>
              <Text
                style={{
                  color: colors.muted,
                  fontSize: typography.metadata,
                  marginTop: spacing.tight,
                  textAlign: "center",
                }}
              >
                You can still clock out without selecting a ticket using the "No
                Ticket" option below.
              </Text>
            </View>
          ) : (
            <FlatList
              data={tickets}
              keyExtractor={(item) => item.id}
              renderItem={renderCompactTicket}
              contentContainerStyle={{
                paddingHorizontal: spacing.section,
                paddingTop: spacing.normal,
                paddingBottom: spacing.section,
              }}
              ItemSeparatorComponent={() => (
                <View style={{ height: spacing.tight }} />
              )}
              style={{ flex: 1, maxHeight: screenHeight }}
            />
          )
        ) : (
          <View
            style={{
              flex: 1,
              paddingHorizontal: spacing.section,
              paddingTop: spacing.normal,
            }}
          >
            {renderMapTab()}
          </View>
        )}

        {/* Footer actions */}
        {!loading && (
          <View
            style={{
              paddingHorizontal: spacing.section,
              paddingTop: spacing.normal,
              paddingBottom: insets.bottom + spacing.normal,
              borderTopWidth: 1,
              borderTopColor: `${colors.muted}22`,
              gap: spacing.tight,
            }}
          >
            {/* No Ticket option */}
            <Pressable
              onPress={handleNoTicket}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: spacing.normal,
                borderRadius: radius.button,
                backgroundColor: pressed
                  ? `${colors.primary}30`
                  : `${colors.primary}15`,
                borderWidth: 1,
                borderColor: `${colors.primary}40`,
                gap: 8,
              })}
            >
              <Ionicons
                name="remove-circle-outline"
                size={18}
                color={colors.primary}
              />
              <Text
                style={{
                  color: colors.primary,
                  fontSize: typography.bodySm,
                  fontWeight: typography.weightSemibold,
                }}
              >
                No Ticket — Clock Out Without Ticket
              </Text>
            </Pressable>

            {/* Cancel button — cancels the entire clock-out */}
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: spacing.normal,
                borderRadius: radius.button,
                backgroundColor: pressed
                  ? `${colors.danger}30`
                  : colors.danger,
                gap: 8,
              })}
            >
              <Ionicons name="close-circle" size={18} color={colors.text} />
              <Text
                style={{
                  color: colors.text,
                  fontSize: typography.bodySm,
                  fontWeight: typography.weightBold,
                }}
              >
                Cancel Clock-Out
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}
