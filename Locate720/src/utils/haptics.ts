import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Trigger a light feedback vibration for primary button presses, toggles, selections.
 */
export function triggerLightHaptic(): void {
  if (Platform.OS === "web") return;
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // Ignore on unsupported platforms/devices
  }
}

/**
 * Trigger a medium feedback vibration for key status transitions or actions.
 */
export function triggerMediumHaptic(): void {
  if (Platform.OS === "web") return;
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  } catch {}
}

/**
 * Trigger success notification haptic (e.g. ticket closed, clock in/out).
 */
export function triggerSuccessHaptic(): void {
  if (Platform.OS === "web") return;
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
  } catch {}
}

/**
 * Trigger warning or error notification haptic (e.g. validation error, warning modal).
 */
export function triggerErrorHaptic(): void {
  if (Platform.OS === "web") return;
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
      () => {},
    );
  } catch {}
}
