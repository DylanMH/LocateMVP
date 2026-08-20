import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../../src/ui/colors";

export default function SupervisorTabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitle: "Locate720 Ops",
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          paddingBottom: insets.bottom,
          height: 56 + insets.bottom,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="overview"
        options={{
          title: "Team Overview",
          tabBarLabel: "Overview",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "grid" : "grid-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="techs"
        options={{
          title: "Techs",
          tabBarLabel: "Techs",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "people" : "people-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Team Map",
          tabBarLabel: "Map",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "map" : "map-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Locate720 Ops",
          tabBarLabel: "Profile",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "person-circle" : "person-circle-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
