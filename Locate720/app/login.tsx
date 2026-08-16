import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/features/auth/AuthContext";
import { colors } from "../src/ui/colors";
import { API_BASE_URL } from "../src/config/api";

interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: string;
  title?: string;
  demoPassword: string;
}

const ROLE_LABELS: Record<string, string> = {
  DISTRICT_MANAGER: "District Manager",
  AREA_MANAGER: "Area Manager",
  SUPERVISOR: "Supervisor",
  TECH: "Tech",
};

const ROLE_COLORS: Record<string, string> = {
  DISTRICT_MANAGER: "#7c3aed",
  AREA_MANAGER: "#2563eb",
  SUPERVISOR: "#0891b2",
  TECH: "#059669",
};

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false);
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Quick login state
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [demoLoading, setDemoLoading] = useState(true);
  const [showCustomLogin, setShowCustomLogin] = useState(false);

  const fetchDemoUsers = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/demo-users`);
      if (response.ok) {
        const data = await response.json();
        setDemoUsers(data.users || []);
      }
    } catch {
      // Silent fail — quick login is a convenience, not critical
    } finally {
      setDemoLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDemoUsers();
  }, [fetchDemoUsers]);

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 403 && data.code === "PASSWORD_MUST_CHANGE") {
          setNeedsPasswordChange(true);
          setTempToken(data.tempToken);
          setEmail(loginEmail);
          setLoading(false);
          return;
        }
        throw new Error(data.error || "Login failed");
      }

      await login({
        token: data.token,
        refreshToken: data.refreshToken,
        user: data.user,
      });

      router.replace("/(tabs)/tickets");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    if (!email || !password) {
      setError("Please enter both email and password");
      return;
    }
    doLogin(email, password);
  };

  const handleQuickLogin = (user: DemoUser) => {
    doLogin(user.email, user.demoPassword);
  };

  const handlePasswordChange = async () => {
    if (!newPassword || newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Password change failed");
      }

      setNeedsPasswordChange(false);
      setTempToken(null);
      setPassword(newPassword);
      await doLogin(email, newPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed");
      setLoading(false);
    }
  };

  if (needsPasswordChange) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
        style={{ backgroundColor: colors.bg }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-6 py-8">
            <Text className="text-3xl font-bold" style={{ color: colors.text }}>
              Change Password
            </Text>
            <Text className="text-base mt-2" style={{ color: colors.muted }}>
              You must set a new password before continuing
            </Text>

            {error && (
              <View
                className="mt-4 p-4 rounded-xl"
                style={{ backgroundColor: colors.danger + "20" }}
              >
                <Text style={{ color: colors.danger }}>{error}</Text>
              </View>
            )}

            <View className="mt-6 space-y-4">
              <View>
                <Text className="text-sm mb-2" style={{ color: colors.muted }}>
                  New Password
                </Text>
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Min 8 characters"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  className="p-4 rounded-xl"
                  style={{ backgroundColor: colors.surface, color: colors.text }}
                  editable={!loading}
                />
              </View>

              <View>
                <Text className="text-sm mb-2" style={{ color: colors.muted }}>
                  Confirm Password
                </Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm new password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  className="p-4 rounded-xl"
                  style={{ backgroundColor: colors.surface, color: colors.text }}
                  editable={!loading}
                />
              </View>

              <Pressable
                onPress={handlePasswordChange}
                disabled={loading}
                className="p-4 rounded-xl mt-4"
                style={{ backgroundColor: colors.primary }}
              >
                {loading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text
                    className="text-center font-semibold"
                    style={{ color: colors.text }}
                  >
                    Set Password & Continue
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-6 py-8">
          <Text className="text-3xl font-bold" style={{ color: colors.text }}>
            Locate720
          </Text>
          <Text className="text-base mt-2" style={{ color: colors.muted }}>
            Sign in to your account
          </Text>

          {error && (
            <View
              className="mt-4 p-4 rounded-xl"
              style={{ backgroundColor: colors.danger + "20" }}
            >
              <Text style={{ color: colors.danger }}>{error}</Text>
            </View>
          )}

          {/* Quick login buttons — shown by default */}
          {!showCustomLogin && (
            <View className="mt-6 space-y-3">
              <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
                Quick Sign In
              </Text>

              {demoLoading ? (
                <View className="p-4 rounded-xl items-center" style={{ backgroundColor: colors.surface }}>
                  <ActivityIndicator color={colors.primary} />
                  <Text className="text-sm mt-2" style={{ color: colors.muted }}>
                    Loading users...
                  </Text>
                </View>
              ) : (
                demoUsers.map((user) => (
                  <Pressable
                    key={user.id}
                    onPress={() => handleQuickLogin(user)}
                    disabled={loading}
                    className="p-4 rounded-xl flex-row items-center justify-between"
                    style={{
                      backgroundColor: colors.surface,
                      borderLeftWidth: 4,
                      borderLeftColor: ROLE_COLORS[user.role] || colors.primary,
                      opacity: loading ? 0.5 : 1,
                    }}
                  >
                    <View className="flex-1">
                      <Text className="text-base font-semibold" style={{ color: colors.text }}>
                        {user.name}
                      </Text>
                      <Text className="text-sm" style={{ color: colors.muted }}>
                        {ROLE_LABELS[user.role] || user.role}
                      </Text>
                    </View>
                    {loading ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                      <Text className="text-sm font-medium" style={{ color: colors.primary }}>
                        Sign In →
                      </Text>
                    )}
                  </Pressable>
                ))
              )}

              {/* Divider */}
              <View className="flex-row items-center my-3">
                <View className="flex-1 h-px" style={{ backgroundColor: colors.muted + "40" }} />
                <Text className="mx-3 text-xs" style={{ color: colors.muted }}>OR</Text>
                <View className="flex-1 h-px" style={{ backgroundColor: colors.muted + "40" }} />
              </View>

              {/* Toggle to custom login */}
              <Pressable
                onPress={() => setShowCustomLogin(true)}
                className="p-4 rounded-xl"
                style={{ backgroundColor: colors.surface }}
              >
                <Text className="text-center text-sm font-medium" style={{ color: colors.primary }}>
                  Sign in with a specific account
                </Text>
              </Pressable>
            </View>
          )}

          {/* Custom login form — shown when toggled */}
          {showCustomLogin && (
            <View className="mt-6 space-y-4">
              <View>
                <Text className="text-sm mb-2" style={{ color: colors.muted }}>
                  Email
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter your email"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  className="p-4 rounded-xl"
                  style={{ backgroundColor: colors.surface, color: colors.text }}
                  editable={!loading}
                />
              </View>

              <View>
                <Text className="text-sm mb-2" style={{ color: colors.muted }}>
                  Password
                </Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  className="p-4 rounded-xl"
                  style={{ backgroundColor: colors.surface, color: colors.text }}
                  editable={!loading}
                />
              </View>

              <Pressable
                onPress={handleLogin}
                disabled={loading}
                className="p-4 rounded-xl mt-4"
                style={{ backgroundColor: colors.primary }}
              >
                {loading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text
                    className="text-center font-semibold"
                    style={{ color: colors.text }}
                  >
                    Sign In
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => setShowCustomLogin(false)}
                className="mt-2"
              >
                <Text className="text-center text-sm" style={{ color: colors.muted }}>
                  ← Back to quick sign in
                </Text>
              </Pressable>
            </View>
          )}

          <View className="mt-8">
            <Text className="text-xs text-center" style={{ color: colors.muted }}>
              Demo password for all accounts: password
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
