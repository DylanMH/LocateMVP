import { View, ActivityIndicator } from "react-native";
import { colors } from "../src/ui/colors";

export default function Index() {
  // Let AuthGuard in _layout.tsx handle the routing
  // This prevents race conditions with Expo Router initialization
  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ backgroundColor: colors.bg }}
    >
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
