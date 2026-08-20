import { Pressable, Text, View, Linking, Platform } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { memo, useEffect, useState } from "react";

import Ticket from "../../../db/models/Ticket";
import { colors } from "../../../ui/colors";
import { spacing } from "../../../ui/spacing";
import { typography } from "../../../ui/typography";
import { radius } from "../../../ui/radius";
import { shadows } from "../../../ui/shadows";
import { formatDueDateTime, formatTime } from "../../../utils/date";
import { formatDuration } from "../../../utils/formatDuration";
import { logger } from "../../../utils/logger";
import { getDueUrgencyBucket, getDueAccentColorFromTimestamp, getRescheduledHalfColors, isRescheduled, DUE_URGENCY_COLORS, DUE_URGENCY_LABELS } from "../domain/dueColor";
import {
  formatTicketType,
  getTicketDisplayData,
} from "../utils/ticketPayload";
import {
  formatLocatorStatus,
  getLocatorStatusColor,
  getTicketTypeColor,
  getUtilityColor,
  getUtilityIcon,
  shouldShowLocatorStatusBadge,
} from "../utils/ticketPresentation";
import { parseTicketPayload } from "../utils/ticketPayload";
import {
  getEnrouteMillis,
  getOnsiteMillis,
  getPausedMillis,
} from "../utils/ticketTime";

function handlePhonePress(phone: string) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  Linking.openURL(`tel:${cleanPhone}`);
}

async function handleAddressPress(address: string) {
  const trimmedAddress = address.trim();
  if (!trimmedAddress) {
    return;
  }

  const encodedAddress = encodeURIComponent(trimmedAddress);
  const primaryUrl =
    Platform.OS === "ios"
      ? `maps:0,0?q=${encodedAddress}`
      : `geo:0,0?q=${encodedAddress}`;
  const fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

  try {
    const canOpenPrimary = await Linking.canOpenURL(primaryUrl);
    await Linking.openURL(canOpenPrimary ? primaryUrl : fallbackUrl);
  } catch (error) {
    logger.error("[TicketCard] Failed to open navigation app:", error);
  }
}

function getDueUrgencyLabel(dueAt?: number): string {
  const bucket = getDueUrgencyBucket(dueAt);
  if (bucket === "none") return "";
  return DUE_URGENCY_LABELS[bucket];
}

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

const TicketCardComponent = ({ ticket, onPress }: { ticket: Ticket; onPress: () => void }) => {
  const dueBorderColor = getDueAccentColorFromTimestamp(ticket.dueAt);
  const halfColors = getRescheduledHalfColors(ticket.dueAt, ticket.originalDueAt);
  const isRescheduledLate = isRescheduled(ticket.dueAt, ticket.originalDueAt);
  const { workType, contractor, contractorPhone, customers } =
    getTicketDisplayData(ticket.payloadJson);

  // Active-status highlighting: when the ticket is ENROUTE, ONSITE, or
  // PAUSED, use the status color for the left border and add a subtle
  // background tint so the active ticket stands out from the list.
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

  const handlePhoneTap = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (contractorPhone) {
      handlePhonePress(contractorPhone);
    }
  };

  const handleAddressTap = async (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    await handleAddressPress(ticket.address);
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
  const dueUrgencyLabel = getDueUrgencyLabel(ticket.dueAt);
  const dueUrgencyColor = dueBorderColor;

  return (
    <Pressable
      onPress={onPress}
      className="mx-4 flex-row"
      style={{
        backgroundColor: isActiveStatus
          ? `${getLocatorStatusColor(ticket.locatorStatus)}10`
          : colors.surface,
        borderRadius: radius.card,
        ...shadows.card,
      }}
    >
      {/* Left color bar — half original-color / half new-due-color when rescheduled */}
      <View
        style={{
          width: isActiveStatus ? 6 : 4,
          borderTopLeftRadius: radius.card,
          borderBottomLeftRadius: radius.card,
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
      <View className="flex-1" style={{ padding: spacing.card }}>
      {/* Top row: ticket number + type */}
      <View className="flex-row items-start justify-between" style={{ marginBottom: spacing.tightSm }}>
        <View className="flex-1" style={{ paddingRight: spacing.sm }}>
          <Text className="font-bold" style={{ color: colors.text, fontSize: typography.body }}>
            {ticket.ticketNumber}
          </Text>
          {/* Sequence badge for linked tickets. Sequence 1 is the original and
              renders no badge to keep the list clean. */}
          {(ticket.sequenceNumber ?? 1) > 1 && ticket.externalRootNumber ? (
            <Text style={{ color: colors.muted, fontSize: typography.caption, marginTop: 2 }}>
              Update #{(ticket.sequenceNumber ?? 1) - 1} of {ticket.externalRootNumber}
            </Text>
          ) : null}
        </View>
        <View style={{ gap: 4, alignItems: 'flex-end' }}>
          <View className="rounded-full" style={{ backgroundColor: getTicketTypeColor(ticket.ticketType), paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
            <Text className="font-semibold" style={{ color: colors.bg, fontSize: typography.caption }} numberOfLines={1}>
              {formatTicketType(ticket.ticketType)}
            </Text>
          </View>
        </View>
      </View>

      {/* Primary: full address (tappable for navigation) */}
      <Pressable onPress={handleAddressTap} hitSlop={8}>
        <Text style={{ color: colors.accent, fontSize: typography.bodySm, textDecorationLine: 'underline' }} numberOfLines={2}>
          {ticket.address}
        </Text>
      </Pressable>

      {/* Secondary: contractor + phone */}
      <View className="flex-row items-center" style={{ marginTop: spacing.tightSm, gap: spacing.xs }}>
        <Ionicons name="business" size={12} color={colors.muted} />
        <Text className="flex-1" style={{ color: colors.text, fontSize: typography.metadata }} numberOfLines={1}>
          {contractor}
        </Text>
        {contractorPhone ? (
          <Pressable onPress={handlePhoneTap} hitSlop={8}>
            <View className="flex-row items-center" style={{ gap: 3 }}>
              <Ionicons name="call" size={12} color={colors.accent} />
              <Text style={{ color: colors.accent, fontSize: typography.metadata }}>
                {contractorPhone}
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* Utilities compact */}
      {customers.length > 0 && (
        <View className="flex-row items-center" style={{ marginTop: spacing.tightSm, gap: 6 }}>
          {customers.map((customer) => (
            <View
              key={customer.id}
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: getUtilityColor(customer.utility),
              }}
            >
              <Ionicons
                name={getUtilityIcon(customer.utility)}
                size={14}
                color="#fff"
              />
            </View>
          ))}
          {workType ? (
            <Text
              className="flex-1"
              style={{ color: colors.muted, fontSize: typography.metadata, marginLeft: 6 }}
              numberOfLines={1}
            >
              {workType}
            </Text>
          ) : null}
        </View>
      )}

      {/* Bottom: due time + urgency (separate channel from workflow state) + workflow state */}
      <View
        className="flex-row items-center justify-between"
        style={{
          marginTop: spacing.normal,
          paddingTop: spacing.normal,
          borderTopWidth: 1,
          borderTopColor: colors.bg,
        }}
      >
        <View className="flex-1" style={{ paddingRight: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: typography.metadata }}>
            {formatDueDateTime(ticket.dueAt)}
          </Text>
          {dueDetail ? (
            <Text style={{ color: dueUrgencyColor, fontSize: typography.caption, fontWeight: typography.weightBold, marginTop: 2 }}>
              {dueDetail}
            </Text>
          ) : dueUrgencyLabel ? (
            <Text style={{ color: dueUrgencyColor, fontSize: typography.caption, fontWeight: typography.weightSemibold, marginTop: 2 }}>
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

        {/* Workflow state badge with icon + elapsed duration (separate visual channel) */}
        {isActiveStatus && (
          <View
            className="flex-row items-center"
            style={{
              gap: 4,
              backgroundColor: getLocatorStatusColor(ticket.locatorStatus),
              borderRadius: radius.buttonSm,
              paddingHorizontal: spacing.sm,
              paddingVertical: 4,
            }}
          >
            {statusIconName && (
              <Ionicons name={statusIconName as any} size={12} color={colors.bg} />
            )}
            <Text className="font-bold" style={{ color: colors.bg, fontSize: typography.caption }}>
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
      </View>
    </Pressable>
  );
};

export const TicketCard = memo(TicketCardComponent);
