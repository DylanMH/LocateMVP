import { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from "react-native";
import 'react-native-get-random-values';
import { v4 as uuidv4 } from "uuid";

import TicketModel from "../../../db/models/Ticket";
import { database } from "../../../db/database";
import { useAuth } from "../../auth/AuthContext";
import { createTicketAttachmentEvent } from "../domain/outbox";
import { SyncEngine } from "../sync/SyncEngine";
import type { TicketAttachment, TicketPayload } from "../types";
import { parseTicketPayload } from "../utils/ticketPayload";
import { logger } from "../../../utils/logger";
import { colors } from "../../../ui/colors";
import { SectionCard } from "./SectionCard";

// Lazy-require native modules so the screen still mounts when the dev client
// has not been rebuilt yet. Rebuild with `npx expo run:android|ios` to enable.
type ImagePickerAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
  width?: number;
  height?: number;
  fileSize?: number;
};
type ImagePickerModule = {
  requestCameraPermissionsAsync: () => Promise<{ status: string }>;
  requestMediaLibraryPermissionsAsync: () => Promise<{ status: string }>;
  launchCameraAsync: (opts: Record<string, unknown>) => Promise<{ canceled: boolean; assets: ImagePickerAsset[] }>;
  launchImageLibraryAsync: (opts: Record<string, unknown>) => Promise<{ canceled: boolean; assets: ImagePickerAsset[] }>;
};

const ImagePicker: ImagePickerModule | null = (() => {
  try {
    return require("expo-image-picker");
  } catch (err) {
    logger.warn("[AttachmentsTab] expo-image-picker native module unavailable:", err);
    return null;
  }
})();

type LocationModule = {
  getForegroundPermissionsAsync: () => Promise<{ status: string }>;
  requestForegroundPermissionsAsync: () => Promise<{ status: string }>;
  getCurrentPositionAsync: (opts: Record<string, unknown>) => Promise<{ coords: { latitude: number; longitude: number } }>;
  Accuracy: { Balanced: number };
};

const Location: LocationModule | null = (() => {
  try {
    return require("expo-location");
  } catch (err) {
    logger.warn("[AttachmentsTab] expo-location native module unavailable:", err);
    return null;
  }
})();

function AttachmentPreview({ a }: { a: TicketAttachment }) {
  const uri = a.localUri || a.remoteUrl;
  return (
    <View className="rounded-xl overflow-hidden" style={{ backgroundColor: colors.surface }}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: 160 }}
          resizeMode="cover"
        />
      ) : (
        <View style={{ height: 160, alignItems: "center", justifyContent: "center" }}>
          <Text className="text-sm" style={{ color: colors.muted }}>
            No preview
          </Text>
        </View>
      )}
      <View className="p-2">
        <Text className="text-xs" style={{ color: colors.text }} numberOfLines={1}>
          {a.fileName || a.id.slice(0, 8)}
        </Text>
        <View className="flex-row items-center justify-between mt-0.5">
          <Text className="text-xs" style={{ color: colors.muted }}>
            {a.uploadedByName || "—"}
          </Text>
          <Text className="text-xs" style={{ color: colors.muted }}>
            {a.syncState === "PENDING" ? "Syncing..." : a.syncState === "FAILED" ? "Failed" : "Synced"}
          </Text>
        </View>
      </View>
    </View>
  );
}

async function getCurrentLocation(): Promise<{ lat: number; lng: number } | undefined> {
  if (!Location) return undefined;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== "granted") return undefined;
    }
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (err) {
    logger.warn("[AttachmentsTab] failed to get location:", err);
    return undefined;
  }
}

interface AttachmentsTabProps {
  ticket: TicketModel;
  isReadOnly: boolean;
}

export function AttachmentsTab({ ticket, isReadOnly }: AttachmentsTabProps) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const payload = parseTicketPayload(ticket.payloadJson);
  const existing: TicketAttachment[] = Array.isArray(payload.attachments)
    ? (payload.attachments as TicketAttachment[])
    : [];

  const attachAssets = async (assets: ImagePickerAsset[]) => {
    if (assets.length === 0) return;
    setBusy(true);
    try {
      const location = await getCurrentLocation();
      const uploaderId = user?.id || "unknown";
      const uploaderName = user?.name || "Unknown";
      const now = Date.now();

      const newAttachments: TicketAttachment[] = assets.map((asset) => ({
        id: uuidv4(),
        kind: "PHOTO",
        fileName: asset.fileName || `photo-${now}.jpg`,
        createdAt: new Date(now).toISOString(),
        localUri: asset.uri,
        mimeType: asset.mimeType || "image/jpeg",
        width: asset.width,
        height: asset.height,
        fileSize: asset.fileSize,
        uploadedByUserId: uploaderId,
        uploadedByName: uploaderName,
        location,
        syncState: "PENDING",
      }));

      await database.write(async () => {
        await ticket.update((t) => {
          const current = parseTicketPayload(t.payloadJson);
          const currentList: TicketAttachment[] = Array.isArray(current.attachments)
            ? (current.attachments as TicketAttachment[])
            : [];
          const nextPayload: TicketPayload = {
            ...current,
            attachments: [...currentList, ...newAttachments],
          };
          t.payloadJson = JSON.stringify(nextPayload);
          t.syncState = "PENDING";
          t.updatedAt = Date.now();
          t.version = t.version + 1;
        });
      });

      for (const attachment of newAttachments) {
        let dataBase64: string | undefined;
        if (attachment.localUri && typeof attachment.localUri === "string") {
          try {
            const res = await fetch(attachment.localUri);
            const blob = await res.blob();
            dataBase64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const result = reader.result as string;
                const comma = result.indexOf(",");
                resolve(comma >= 0 ? result.substring(comma + 1) : result);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch (err) {
            logger.warn("[AttachmentsTab] failed to encode image as base64:", err);
          }
        }

        await SyncEngine.queueEvent(
          createTicketAttachmentEvent({
            attachmentId: attachment.id,
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            uploaderId,
            uploaderName,
            kind: attachment.kind,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            width: attachment.width,
            height: attachment.height,
            fileSize: attachment.fileSize,
            lat: attachment.location?.lat,
            lng: attachment.location?.lng,
            dataBase64,
            capturedAt: now,
          }),
        );
      }
    } catch (err) {
      logger.error("[AttachmentsTab] failed to attach images:", err);
      Alert.alert("Error", "Failed to attach images. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    if (!ImagePicker) {
      Alert.alert(
        "Camera unavailable",
        "Rebuild the dev client (npx expo run:android / run:ios) to enable the camera.",
      );
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Permission required", "Camera access is required to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      exif: true,
    });
    if (!result.canceled) {
      await attachAssets(result.assets);
    }
  };

  const pickFromGallery = async () => {
    if (!ImagePicker) {
      Alert.alert(
        "Gallery unavailable",
        "Rebuild the dev client (npx expo run:android / run:ios) to enable gallery access.",
      );
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Permission required", "Photo library access is required to attach images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.6,
      exif: true,
    });
    if (!result.canceled) {
      await attachAssets(result.assets);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      {!isReadOnly && (
        <SectionCard title="Add Attachment">
          <View className="flex-row" style={{ gap: 10 }}>
            <Pressable
              onPress={takePhoto}
              disabled={busy}
              className="flex-1 rounded-xl py-3 items-center"
              style={{ backgroundColor: busy ? colors.surface : colors.primary, opacity: busy ? 0.5 : 1 }}
            >
              <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                Camera
              </Text>
            </Pressable>
            <Pressable
              onPress={pickFromGallery}
              disabled={busy}
              className="flex-1 rounded-xl py-3 items-center"
              style={{ backgroundColor: busy ? colors.surface : colors.accent, opacity: busy ? 0.5 : 1 }}
            >
              <Text className="text-sm font-semibold" style={{ color: colors.bg }}>
                Gallery
              </Text>
            </Pressable>
          </View>
          {busy && (
            <View className="mt-3 items-center">
              <ActivityIndicator color={colors.text} />
              <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                Attaching...
              </Text>
            </View>
          )}
        </SectionCard>
      )}

      <SectionCard
        title={existing.length > 0 ? `Attachments (${existing.length})` : "Attachments"}
      >
        {existing.length === 0 ? (
          <Text className="text-sm" style={{ color: colors.muted }}>
            No attachments yet.
          </Text>
        ) : (
          <View style={{ gap: 10 }}>
            {existing.map((a) => (
              <AttachmentPreview key={a.id} a={a} />
            ))}
          </View>
        )}
      </SectionCard>
    </View>
  );
}

