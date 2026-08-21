import { memo, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Ticket from "../../../db/models/Ticket";
import { formatDueDateTime, formatTime } from "../../../utils/date";
import { formatDuration } from "../../../utils/formatDuration";
import { getDueUrgencyBucket, getDueAccentColorFromTimestamp, getRescheduledHalfColors, isRescheduled, DUE_URGENCY_COLORS, DUE_URGENCY_LABELS } from "../domain/dueColor";
import {
  formatTicketType,
  getTicketDisplayData,
  parseTicketPayload,
} from "../utils/ticketPayload";
import {
  formatLocatorStatus,
  getLocatorStatusColor,
  getTicketTypeColor,
  getUtilityColor,
  getUtilityIcon,
  shouldShowLocatorStatusBadge,
} from "../utils/ticketPresentation";
import { colors } from "../../../ui/colors";
import { spacing } from "../../../ui/spacing";
import { typography } from "../../../ui/typography";
import { radius } from "../../../ui/radius";
import { triggerLightHaptic } from "../../../utils/haptics";
import {
  getEnrouteMillis,
  getOnsiteMillis,
  getPausedMillis,
} from "../utils/ticketTime";

function getDueUrgencyDetail(dueAt?: number): string {
  const bucket = getDueUrgencyBucket(dueAt);
  if (bucket === "none" || !dueAt) return "";
  const now = Date.now();
  const diffMs = dueAt - now;
  const absMs = Math.abs(diffMs);
  const absMinutes = Math.floor(absMs / 60000);
  const absHours = Math.floor(absMinutes / 60);
  const remMinutes = absMinutes % 60;

  if (bucket === "overdue") {
    if (absHours > 0) {
      return `OVERDUE · ${absHours}h ${remMinutes}m`;
    }
    return `OVERDUE · ${absMinutes}m`;
  }
  if (bucket === "urgent") {
    if (absHours > 0) {
      return `DUE SOON · ${absHours}h ${remMinutes}m`;
    }
    return `DUE SOON · ${absMinutes}m`;
  }
  return "";
}

const CompactTicketCardComponent = ({
  ticket,
  onPress,
}: {
  ticket: Ticket;
  onPress: () => void;
}) => {
  const dueBorderColor = getDueAccentColorFromTimestamp(ticket.dueAt);
  const halfColors = getRescheduledHalfColors(ticket.dueAt, ticket.originalDueAt);
  const isRescheduledLate = isRescheduled(ticket.dueAt, ticket.originalDueAt);
  const { customers, workType } = getTicketDisplayData(ticket.payloadJson);

  // Active-status highlighting: use status color for border + subtle tint
  const isActiveStatus = shouldShowLocatorStatusBadge(ticket.locatorStatus);
  const accentColor = isActiveStatus
    ? getLocatorStatusColor(ticket.locatorStatus)
    : dueBorderColor;

  // Live duration tick for active workflow states
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isActiveStatus) return;
    setTick((prev) => prev + 1);
    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 10000);
    return () => clearInterval(interval);
  }, [isActiveStatus, ticket.locatorStatus]);

  const payload = parseTicketPayload(ticket.payloadJson);
  const enrouteMillis = getEnrouteMillis(payload, ticket.locatorStatus);
  const onsiteMillis = getOnsiteMillis(payload, ticket.locatorStatus);
  const pausedMillis = getPausedMillis(payload);

  const handlePress = () => {
    triggerLightHaptic();
    onPress();
  };

  const statusIconName: string | null = isActiveStatus
    ? ticket.locatorStatus === "ENROUTE"
      ? "navigate"
      : ticket.locatorStatus === "ONSITE"
        ? "locate"
        : ticket.locatorStatus === "PAUSED"
          ? "pause"
          : null
    : null;

  const statusDurationLabel = isActiveStatus
    ? ticket.locatorStatus === "ENROUTE"
      ? formatDuration(enrouteMillis)
      : ticket.locatorStatus === "ONSITE"
        ? formatDuration(onsiteMillis)
        : ticket.locatorStatus === "PAUSED"
          ? formatDuration(pausedMillis)
          : null
    : null;

  const dueDetail = getDueUrgencyDetail(ticket.dueAt);
  const dueUrgencyLabel = getDueUrgencyBucket(ticket.dueAt) !== "none" ? DUE_URGENCY_LABELS[getDueUrgencyBucket(ticket.dueAt)] : "";
  const dueUrgencyColor = dueBorderColor;

  return (
    <Pressable
      onPress={handlePress}
      className="mx-4 flex-row"
      style={{
        backgroundColor: isActiveStatus
          ? `${getLocatorStatusColor(ticket.locatorStatus)}10`
          : colors.surface,
        borderRadius: radius.cardSm,
      }}
    >
      {/* Left color bar — half original-color / half new-due-color when rescheduled */}
      <View
        style={{
          width: isActiveStatus ? 6 : 4,
          borderTopLeftRadius: radius.cardSm,
          borderBottomLeftRadius: radius.cardSm,
          backgroundColor: halfColors ? halfColors.topColor : accentColor,
        }}
      >
        {halfColors && (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: halfColors.topColor }} />
            <View style={{ flex: 1, backgroundColor: halfColors.bottomColor }} />
          </View>
        )}
      </View>
      <View className="flex-1" style={{ paddingHorizontal: spacing.cardSm, paddingVertical: spacing.tight }}>
      {/* Top row: ticket number + workflow state badge */}
      <View className="flex-row items-center justify-between">
        <View className="flex-1" style={{ marginRight: spacing.sm }}>
          <View className="flex-row items-center">
            <Text
              className="font-bold"
              style={{ color: colors.text, fontSize: typography.bodySm, marginRight: spacing.tightSm }}
              numberOfLines={1}
            >
              {ticket.ticketNumber}
            </Text>
            {isActiveStatus && (
              <View
                className="flex-row items-center"
                style={{
                  gap: 3,
                  backgroundColor: getLocatorStatusColor(ticket.locatorStatus),
                  borderRadius: radius.buttonSm,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                }}
              >
                {statusIconName && (
                  <Ionicons name={statusIconName as any} size={10} color={colors.bg} />
                )}
                <Text
                  className="font-bold"
                  style={{ color: colors.bg, fontSize: typography.captionSm }}
                >
                  {formatLocatorStatus(ticket.locatorStatus).toUpperCase()}
                </Text>
                {statusDurationLabel && (
                  <Text style={{ color: colors.bg, fontSize: typography.captionSm, fontWeight: typography.weightSemibold }}>
                    · {statusDurationLabel}
                  </Text>
                )}
              </View>
            )}
          </View>
          <Text
            style={{ color: colors.muted, fontSize: typography.metadata, marginTop: 2 }}
            numberOfLines={1}
          >
            {ticket.address}
          </Text>
        </View>

        <View className="items-end">
          <View
            className="rounded-full"
            style={{ backgroundColor: getTicketTypeColor(ticket.ticketType), paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: 4 }}
          >
            <Text
              className="font-semibold"
              style={{ color: colors.bg, fontSize: typography.captionSm }}
              numberOfLines={1}
            >
              {formatTicketType(ticket.ticketType)}
            </Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: typography.caption }}>
            {formatDueDateTime(ticket.dueAt)}
          </Text>
          {dueDetail ? (
            <Text
              style={{ color: dueUrgencyColor, fontSize: typography.captionSm, fontWeight: typography.weightBold, marginTop: 2 }}
              numberOfLines={1}
            >
              {dueDetail}
            </Text>
          ) : dueUrgencyLabel ? (
            <Text
              style={{ color: dueUrgencyColor, fontSize: typography.captionSm, fontWeight: typography.weightSemibold, marginTop: 2 }}
              numberOfLines={1}
            >
              {dueUrgencyLabel.toUpperCase()}
            </Text>
          ) : null}
          {isRescheduledLate && ticket.originalDueAt && (
            <Text
              style={{ color: DUE_URGENCY_COLORS.overdue, fontSize: typography.captionSm, marginTop: 2 }}
              numberOfLines={1}
            >
              Orig: {formatTime(ticket.originalDueAt)}
            </Text>
          )}
        </View>
      </View>

      {customers.length > 0 && (
        <View className="flex-row items-center" style={{ marginTop: 6, gap: 4 }}>
          {customers.map((customer) => (
            <View
              key={customer.id}
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: getUtilityColor(customer.utility),
              }}
            >
              <Ionicons
                name={getUtilityIcon(customer.utility)}
                size={10}
                color="#fff"
              />
            </View>
          ))}
          {workType ? (
            <Text
              className="flex-1"
              style={{ color: colors.muted, fontSize: typography.caption, marginLeft: 6 }}
              numberOfLines={1}
            >
              {workType}
            </Text>
          ) : null}
        </View>
      )}
      </View>
    </Pressable>
  );
};

export const CompactTicketCard = memo(CompactTicketCardComponent);
