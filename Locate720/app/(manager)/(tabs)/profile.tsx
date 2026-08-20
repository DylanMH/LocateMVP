import { useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/ui/colors";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { logger } from "../../../src/utils/logger";

const ROLE_COLORS: Record<string, string> = {
  AREA_MANAGER: "#2563eb",
  DISTRICT_MANAGER: "#7c3aed",
};

const ROLE_LABELS: Record<string, string> = {
  AREA_MANAGER: "Area Manager",
  DISTRICT_MANAGER: "District Manager",
};

export default function ManagerProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          if (!user) return;
          setIsSigningOut(true);
          try {
            await logout();
            router.replace("/");
          } catch (error) {
            logger.error("[Manager Profile] Sign out failed:", error);
            Alert.alert(
              "Unable to Sign Out",
              error instanceof Error ? error.message : "Try again.",
            );
          } finally {
            setIsSigningOut(false);
          }
        },
      },
    ]);
  };

  const roleColor = (user?.role && ROLE_COLORS[user.role]) || colors.primary;
  const roleLabel = (user?.role && ROLE_LABELS[user.role]) || user?.role || "N/A";

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <ScrollView className="flex-1 px-5 pt-6">
        <Text className="text-2xl font-bold mb-6" style={{ color: colors.text }}>
          Profile
        </Text>

        {/* User Identity Card */}
        <View
          className="rounded-2xl p-5 mb-5"
          style={{ backgroundColor: colors.surface }}
        >
          <View className="flex-row items-center mb-3">
            <View
              className="w-12 h-12 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: roleColor }}
            >
              <Text
                className="text-lg font-bold"
                style={{ color: colors.text }}
              >
                {(user?.name || "U")[0].toUpperCase()}
              </Text>
            </View>
            <View className="flex-1">
              <Text
                className="text-lg font-bold"
                style={{ color: colors.text }}
              >
                {user?.name || "Unknown"}
              </Text>
              <Text className="text-sm" style={{ color: colors.muted }}>
                {user?.email || "N/A"}
              </Text>
            </View>
            <View
              className="rounded-lg px-2.5 py-1"
              style={{ backgroundColor: roleColor + "20" }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: roleColor }}
              >
                {roleLabel}
              </Text>
            </View>
          </View>
          <View
            className="flex-row items-center mt-2 pt-2"
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.bg,
              gap: 6,
            }}
          >
            <Ionicons name="shield-checkmark" size={14} color={colors.muted} />
            <Text className="text-sm" style={{ color: colors.muted }}>
              Manager
            </Text>
          </View>
        </View>

        {/* Sign Out */}
        <Pressable
          onPress={handleSignOut}
          disabled={isSigningOut}
          className="rounded-xl px-4 py-3.5 mb-10 flex-row items-center justify-center"
          style={{
            backgroundColor: colors.danger,
            opacity: isSigningOut ? 0.5 : 1,
            gap: 8,
            minHeight: 48,
          }}
        >
          {isSigningOut ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons name="log-out" size={18} color={colors.text} />
          )}
          <Text
            className="text-base font-semibold"
            style={{ color: colors.text, includeFontPadding: false }}
            numberOfLines={1}
          >
            Sign Out
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
