import "../global.css";
import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, Text, ActivityIndicator } from "react-native";
import { AuthProvider, useAuth } from "../src/features/auth/AuthContext";
import { colors } from "../src/ui/colors";
import { database } from "../src/db/database";
import DaySession from "../src/db/models/DaySession";
import { Q } from "@nozbe/watermelondb";
import { locationTracker } from "../src/features/tracking/locationTracker";
import { getTodayDateString } from "../src/features/timesheet/utils/breakStatus";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, token, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Keep location tracking synchronized with active clocked-in session
  useEffect(() => {
    locationTracker.setAuthToken(token);

    if (!user) {
      locationTracker.updateClockState(null, false, null);
      return;
    }

    const today = getTodayDateString();
    const sessionsCollection =
      database.collections.get<DaySession>("day_sessions");

    const subscription = sessionsCollection
      .query(Q.where("user_id", user.id), Q.where("date", today))
      .observe()
      .subscribe((sessions) => {
        const active = sessions.find((s) => s.status === "ACTIVE");
        const isClockedIn = Boolean(active);
        locationTracker.updateClockState(user.id, isClockedIn, active?.id || null);
      });

    return () => {
      subscription.unsubscribe();
    };
  }, [user, token]);

  useEffect(() => {
    console.log(
      "[AuthGuard] isLoading:",
      isLoading,
      "user:",
      user?.name || "null",
      "segments:",
      segments,
    );

    if (isLoading) return;

    const inAuthGroup = segments[0] === "login";
    const inTabsGroup = segments[0] === "(tabs)";
    const inTicketDetails = segments[0] === "ticket-details";

    if (!user && !inAuthGroup) {
      // Redirect to login if not authenticated
      console.log("[AuthGuard] Redirecting to login (no user)");
      router.replace("/login" as any);
    } else if (user && inAuthGroup) {
      // Redirect to tickets if already authenticated and on login page
      console.log("[AuthGuard] Redirecting to tickets (user logged in)");
      router.replace("/(tabs)/tickets" as any);
    } else if (user && !inTabsGroup && !inTicketDetails) {
      // Redirect to tickets if authenticated but not in tabs or ticket details (e.g., on index)
      console.log("[AuthGuard] Redirecting to tickets (not in tabs)");
      router.replace("/(tabs)/tickets" as any);
    }
  }, [user, isLoading, segments, router]);

  if (isLoading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="mt-4" style={{ color: colors.text }}>
          Loading...
        </Text>
      </View>
    );
  }

  return <>{children}</>;
}

/**
 * Clean up orphaned ACTIVE sessions from app crashes or force-quits.
 * Only closes sessions from previous days to avoid interfering with current day.
 */
async function cleanOrphanedSessions() {
  try {
    const today = getTodayDateString();
    const sessionsCollection =
      database.collections.get<DaySession>("day_sessions");

    const orphanedSessions = await sessionsCollection
      .query(
        Q.where("status", "ACTIVE"),
        Q.where("date", Q.notEq(today)), // Only sessions from previous days
      )
      .fetch();

    if (orphanedSessions.length > 0) {
      console.log(
        `[App] Found ${orphanedSessions.length} orphaned ACTIVE sessions, cleaning up...`,
      );

      await database.write(async () => {
        for (const session of orphanedSessions) {
          await session.update((s) => {
            s.status = "CLOCKED_OUT";
            s.clockOutAt = s.clockInAt + 1000; // 1 second after clock in
          });
        }
      });

      console.log(`[App] Cleaned ${orphanedSessions.length} orphaned sessions`);
    }
  } catch (error) {
    console.error("[App] Failed to clean orphaned sessions:", error);
  }
}

export default function RootLayout() {
  const [isDbReady, setIsDbReady] = useState(false);

  useEffect(() => {
    const initializeDb = async () => {
      try {
        console.log("[App] Starting database initialization...");
        // Clean up orphaned ACTIVE sessions (from crashes, force-quits, etc.)
        await cleanOrphanedSessions();
        console.log("[App] Database initialized successfully");
      } catch (error) {
        console.error("[App] Failed to initialize database:", error);
      } finally {
        console.log("[App] Setting isDbReady to true");
        setIsDbReady(true);
      }
    };

    initializeDb();
  }, []);

  if (!isDbReady) {
    return (
      <SafeAreaProvider>
        <View
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: colors.bg }}
        >
          <ActivityIndicator size="large" color={colors.primary} />
          <Text className="text-sm mt-4" style={{ color: colors.muted }}>
            Initializing database...
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <AuthProvider>
      <SafeAreaProvider>
        <AuthGuard>
          <Stack
            screenOptions={{
              headerShown: false,
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="ticket-details/[id]"
              options={{ headerShown: true, title: "Ticket Details" }}
            />
          </Stack>
        </AuthGuard>
      </SafeAreaProvider>
    </AuthProvider>
  );
}
