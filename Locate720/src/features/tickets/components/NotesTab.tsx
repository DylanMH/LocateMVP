import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import withObservables from "@nozbe/with-observables";
import 'react-native-get-random-values';
import { v4 as uuidv4 } from "uuid";

import { database } from "../../../db/database";
import TicketNote, { type NoteType } from "../../../db/models/TicketNote";
import { useAuth } from "../../auth/AuthContext";
import { createTicketNoteEvent } from "../domain/outbox";
import { SyncEngine } from "../sync/SyncEngine";
import { colors } from "../../../ui/colors";
import { SectionCard } from "./SectionCard";

function formatNoteTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NoteRow({ note }: { note: TicketNote }) {
  const isDispatch = note.noteType === "DISPATCH";
  return (
    <View
      className="rounded-xl p-3"
      style={{
        backgroundColor: isDispatch ? colors.primary : colors.surface,
        borderLeftWidth: 3,
        borderLeftColor: isDispatch ? colors.accent : colors.muted,
      }}
    >
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-xs font-semibold" style={{ color: colors.text }}>
          {note.authorName || "Unknown"}
        </Text>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          {isDispatch && (
            <View
              className="rounded px-2 py-0.5"
              style={{ backgroundColor: colors.accent }}
            >
              <Text className="text-xs font-bold" style={{ color: colors.bg }}>
                Dispatch
              </Text>
            </View>
          )}
          <Text className="text-xs" style={{ color: colors.muted }}>
            {formatNoteTime(note.createdAt)}
          </Text>
        </View>
      </View>
      <Text className="text-sm" style={{ color: colors.text }}>
        {note.body}
      </Text>
      {note.syncState === "PENDING" && (
        <Text className="text-xs mt-1" style={{ color: colors.muted }}>
          Syncing...
        </Text>
      )}
    </View>
  );
}

interface NotesTabInnerProps {
  ticketId: string;
  ticketNumber: string;
  notes: TicketNote[];
  isReadOnly: boolean;
}

function NotesTabInner({ ticketId, ticketNumber, notes, isReadOnly }: NotesTabInnerProps) {
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [noteType, setNoteType] = useState<NoteType>("INTERNAL");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const noteId = uuidv4();
      const createdAt = Date.now();
      const authorId = user?.id || "unknown";
      const authorName = user?.name || "Unknown";

      const notesCollection = database.collections.get<TicketNote>("ticket_notes");
      await database.write(async () => {
        await notesCollection.create((n) => {
          n._raw.id = noteId;
          n.ticketId = ticketId;
          n.ticketNumber = ticketNumber;
          n.authorId = authorId;
          n.authorName = authorName;
          n.body = trimmed;
          n.noteType = noteType;
          n.createdAt = createdAt;
          n.syncState = "PENDING";
          n.requestId = noteId;
        });
      });

      await SyncEngine.queueEvent(
        createTicketNoteEvent({
          noteId,
          ticketId,
          ticketNumber,
          body: trimmed,
          noteType,
          authorId,
          authorName,
          createdAt,
        }),
      );

      setBody("");
    } catch (err) {
      Alert.alert("Error", "Failed to save note. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      {notes.length === 0 ? (
        <SectionCard title="Notes">
          <Text className="text-sm" style={{ color: colors.muted }}>
            No notes yet.
          </Text>
        </SectionCard>
      ) : (
        <SectionCard title={`Notes (${notes.length})`}>
          <View style={{ gap: 10 }}>
            {notes.map((note) => (
              <NoteRow key={note.id} note={note} />
            ))}
          </View>
        </SectionCard>
      )}

      {!isReadOnly && (
        <SectionCard title="Add Note">
          <View className="flex-row mb-3" style={{ gap: 8 }}>
            <Pressable
              onPress={() => setNoteType("INTERNAL")}
              className="flex-1 rounded-lg py-2 items-center"
              style={{
                backgroundColor:
                  noteType === "INTERNAL" ? colors.primary : colors.surface,
              }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.text }}
              >
                Internal
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setNoteType("DISPATCH")}
              className="flex-1 rounded-lg py-2 items-center"
              style={{
                backgroundColor:
                  noteType === "DISPATCH" ? colors.accent : colors.surface,
              }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: noteType === "DISPATCH" ? colors.bg : colors.text }}
              >
                Dispatch
              </Text>
            </Pressable>
          </View>

          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            placeholder="Write a note..."
            placeholderTextColor={colors.muted}
            style={{
              backgroundColor: colors.bg,
              color: colors.text,
              minHeight: 90,
              borderWidth: 1,
              borderColor: colors.surface,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              textAlignVertical: "top",
            }}
          />

          <Pressable
            onPress={handleAdd}
            disabled={saving || !body.trim()}
            className="mt-3 rounded-xl py-3 items-center"
            style={{
              backgroundColor:
                saving || !body.trim() ? colors.surface : colors.primary,
              opacity: saving || !body.trim() ? 0.5 : 1,
            }}
          >
            {saving ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.text }}
              >
                Save Note
              </Text>
            )}
          </Pressable>
        </SectionCard>
      )}
    </View>
  );
}

const enhance = withObservables(
  ["ticketId"],
  ({ ticketId }: { ticketId: string; ticketNumber: string; isReadOnly: boolean }) => ({
    notes: database.collections
      .get<TicketNote>("ticket_notes")
      .query(Q.where("ticket_id", ticketId), Q.sortBy("created_at", Q.asc))
      .observe(),
  }),
);

export const NotesTab = enhance(NotesTabInner) as React.ComponentType<{
  ticketId: string;
  ticketNumber: string;
  isReadOnly: boolean;
}>;
