import { Stack } from "expo-router";

export default function SupervisorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="tech-details/[id]" />
      <Stack.Screen name="ops-ticket/[id]" />
    </Stack>
  );
}
