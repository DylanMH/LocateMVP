import { useState, useEffect } from "react";
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

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Please enter both email and password");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Check if password change is required
        if (response.status === 403 && data.code === "PASSWORD_MUST_CHANGE") {
          setNeedsPasswordChange(true);
          setTempToken(data.tempToken);
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

      // Now login with the new password
      setNeedsPasswordChange(false);
      setTempToken(null);
      setPassword(newPassword);
      await handleLogin();
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
          </View>

          <View className="mt-8">
            <Text className="text-xs text-center" style={{ color: colors.muted }}>
              Dev mode: Use seeded user emails like bob@locate720.com with any password
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
