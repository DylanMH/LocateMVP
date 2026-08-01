import { Text, View } from "react-native";

import { colors } from "../../../ui/colors";

export function MarkingInstructionsCard({ instructions }: { instructions: string | undefined }) {
  const value = instructions?.trim();

  return (
    <View className="rounded-2xl p-4" style={{ backgroundColor: colors.surface }}>
      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
        Marking instructions
      </Text>
      <Text className="text-sm mt-2" style={{ color: value ? colors.text : colors.muted }}>
        {value ? value : "No marking instructions provided."}
      </Text>
    </View>
  );
}
