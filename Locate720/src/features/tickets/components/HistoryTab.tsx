import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import Ticket from "../../../db/models/Ticket";
import {
  formatTicketType,
  getTicketDisplayData,
} from "../utils/ticketPayload";
import { getTicketTypeColor } from "../utils/ticketPresentation";
import { colors } from "../../../ui/colors";
import { SectionCard } from "./SectionCard";
import type { Customer } from "../types";

function formatShortDate(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCustomerMarkingSummary(marking?: { status?: string; result?: string; completed?: boolean }): string {
  if (!marking) return "—";
  const statusLabel = marking.completed
    ? "Marked"
    : marking.status
      ? marking.status.replace(/_/g, " ")
      : "";
  const resultLabel = marking.result ? marking.result.replace(/_/g, " ") : "";

  if (statusLabel && resultLabel) {
    return `${statusLabel} · ${resultLabel}`;
  }
  return statusLabel || resultLabel || "—";
}

function CustomerStatusRow({ customer, marking }: { customer: Customer; marking?: { status?: string; result?: string; completed?: boolean } }) {
  const completed = marking?.completed === true;
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-sm flex-1" style={{ color: colors.text }} numberOfLines={1}>
        {customer.name}
      </Text>
      <Text
        className="text-xs font-semibold ml-2"
        style={{ color: completed ? colors.success : colors.muted }}
      >
        {formatCustomerMarkingSummary(marking)}
      </Text>
    </View>
  );
}

function RelatedTicketCard({ ticket, isCurrent }: { ticket: Ticket; isCurrent: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { customers, payload } = getTicketDisplayData(ticket.payloadJson);
  const marking = payload.customerMarking || payload.customerMarkings || {};
  const seq = ticket.sequenceNumber ?? 1;
  const sequenceLabel = seq <= 1 ? "Original" : `#${seq}`;

  // Tap outside the expand arrow: navigate to that ticket's details so the
  // tech can work it independently. This is the whole point of the linked-
  // ticket model: each row remains its own operational ticket.
  const handleOpen = () => {
    if (isCurrent) {
      setExpanded((v) => !v);
      return;
    }
    router.push(`/ticket-details/${ticket.id}`);
  };

  return (
    <Pressable
      onPress={handleOpen}
      onLongPress={() => setExpanded((v) => !v)}
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: colors.surface,
        borderWidth: isCurrent ? 2 : 0,
        borderColor: isCurrent ? colors.primary : "transparent",
      }}
    >
      <View className="p-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <View
              className="px-2 py-0.5 rounded-full"
              style={{ backgroundColor: getTicketTypeColor(ticket.ticketType) }}
            >
              <Text className="text-xs font-semibold" style={{ color: colors.bg }}>
                {formatTicketType(ticket.ticketType)}
              </Text>
            </View>
            <Text className="text-xs font-semibold" style={{ color: colors.muted }}>
              {sequenceLabel}
            </Text>
          </View>
          <Text className="text-xs" style={{ color: colors.muted }}>
            {isCurrent ? "(current)" : "open ›"}
          </Text>
        </View>

        <Text className="text-sm font-bold mt-2" style={{ color: colors.text }}>
          {ticket.ticketNumber}
        </Text>
        <Text className="text-xs mt-0.5" style={{ color: colors.muted }}>
          Due {formatShortDate(ticket.dueAt)} · {ticket.locatorStatus}
        </Text>
      </View>

      {expanded && (
        <View
          className="px-3 pb-3"
          style={{ borderTopWidth: 1, borderTopColor: colors.bg }}
        >
          {customers.length > 0 ? (
            <>
              <Text
                className="text-xs font-semibold mt-2 mb-1"
                style={{ color: colors.muted }}
              >
                Customer Status
              </Text>
              {customers.map((c) => (
                <CustomerStatusRow
                  key={c.id}
                  customer={c}
                  marking={(marking as Record<string, { status?: string; result?: string; completed?: boolean }>)[c.id]}
                />
              ))}
            </>
          ) : (
            <Text className="text-sm mt-2" style={{ color: colors.muted }}>
              No customer data.
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

interface HistoryTabProps {
  currentTicket: Ticket;
  relatedTickets: Ticket[];
}

export function HistoryTab({ currentTicket, relatedTickets }: HistoryTabProps) {
  // Merge the current ticket into the lineage chain and sort by sequence_number,
  // falling back to created/updated for legacy rows without lineage. Each row
  // stays independent for work/time/footage \u2014 this tab only shows history.
  const chain = [...relatedTickets];
  if (!chain.some((t) => t.id === currentTicket.id)) {
    chain.push(currentTicket);
  }
  chain.sort((a, b) => {
    const seqA = a.sequenceNumber ?? 1;
    const seqB = b.sequenceNumber ?? 1;
    if (seqA !== seqB) return seqA - seqB;
    return (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
  });

  const rootNumber =
    currentTicket.externalRootNumber ||
    chain.find((t) => (t.sequenceNumber ?? 1) === 1)?.ticketNumber ||
    currentTicket.ticketNumber;

  return (
    <View style={{ gap: 12 }}>
      <SectionCard title={`Ticket Chain \u2014 ${rootNumber}`}>
        <Text className="text-xs" style={{ color: colors.muted }}>
          Each ticket below is an independent operational ticket. Time, footage,
          notes, and photos stay with the ticket where they were captured.
        </Text>
      </SectionCard>

      <SectionCard
        title={`Timeline (${chain.length})`}
      >
        <View style={{ gap: 10 }}>
          {chain.map((t) => (
            <RelatedTicketCard
              key={t.id}
              ticket={t}
              isCurrent={t.id === currentTicket.id}
            />
          ))}
        </View>
      </SectionCard>
    </View>
  );
}
