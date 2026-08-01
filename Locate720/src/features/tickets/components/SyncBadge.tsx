import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { colors } from "../../../ui/colors";
import { SyncEngine, type SyncState } from "../sync/SyncEngine";

function getLabel(state: SyncState): string {
  if (!state.isOnline) {
    return state.pendingCount > 0 ? `Offline • Pending ${state.pendingCount}` : "Offline";
  }
  if (state.isSyncing) {
    return "Syncing…";
  }
  if (state.pendingCount > 0) {
    return `Pending ${state.pendingCount}`;
  }
  return "Synced";
}

function getBgColor(state: SyncState): string {
  if (!state.isOnline) return colors.danger;
  if (state.isSyncing) return colors.primary;
  if (state.pendingCount > 0) return colors.accent;
  return colors.success;
}

export function SyncBadge() {
  const [syncState, setSyncState] = useState<SyncState>(SyncEngine.getSyncState());

  useEffect(() => {
    const unsubscribe = SyncEngine.subscribe(setSyncState);
    return unsubscribe;
  }, []);

  return (
    <View className="px-3 py-1 rounded-full" style={{ backgroundColor: getBgColor(syncState) }}>
      <Text className="text-xs font-semibold" style={{ color: colors.bg }}>
        {getLabel(syncState)}
      </Text>
    </View>
  );
}
