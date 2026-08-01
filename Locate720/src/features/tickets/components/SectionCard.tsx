import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { colors } from "../../../ui/colors";

export function SectionCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View className="rounded-2xl p-4" style={{ backgroundColor: colors.surface }}>
      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
        {title}
      </Text>
      <View className="mt-3">{children}</View>
    </View>
  );
}
