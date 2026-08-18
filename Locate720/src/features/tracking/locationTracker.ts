import { Platform } from "react-native";
import { API_BASE_URL } from "../../config/api";
import { logger } from "../../utils/logger";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout";

type LocationModule = {
  Accuracy: {
    Balanced: number;
    High: number;
  };
  getForegroundPermissionsAsync: () => Promise<{ status: string }>;
  requestForegroundPermissionsAsync: () => Promise<{ status: string }>;
  getCurrentPositionAsync: (options?: {
    accuracy?: number;
  }) => Promise<{
    coords: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      heading?: number | null;
      speed?: number | null;
    };
    timestamp: number;
  }>;
};

const Location: LocationModule | null = (() => {
  try {
    return require("expo-location");
  } catch (err) {
    logger.warn("[LocationTracker] expo-location unavailable:", err);
    return null;
  }
})();

class LocationTrackerService {
  private trackingInterval: ReturnType<typeof setInterval> | null = null;
  private currentUserId: string | null = null;
  private isClockedIn: boolean = false;
  private sessionId: string | null = null;
  private authToken: string | null = null;

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  public updateClockState(
    userId: string | null,
    isClockedIn: boolean,
    sessionId: string | null,
  ): void {
    this.currentUserId = userId;
    this.isClockedIn = isClockedIn;
    this.sessionId = sessionId;

    if (isClockedIn && userId) {
      this.startTracking();
    } else {
      this.stopTracking();
    }
  }

  private startTracking(): void {
    if (this.trackingInterval || !Location) return;
    logger.log("[LocationTracker] Starting location tracking (clocked in)...");

    // Immediately send a location sample
    this.sampleAndSendLocation();

    // Periodic ping every 30 seconds while clocked in
    this.trackingInterval = setInterval(() => {
      this.sampleAndSendLocation();
    }, 30000);
  }

  private stopTracking(): void {
    if (this.trackingInterval) {
      logger.log("[LocationTracker] Stopping location tracking (clocked out)");
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
  }

  private async sampleAndSendLocation(): Promise<void> {
    if (!this.isClockedIn || !this.currentUserId || !Location) return;

    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.status !== "granted") return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude, accuracy, heading, speed } = pos.coords;

      const payload = {
        locations: [
          {
            userId: this.currentUserId,
            sessionId: this.sessionId,
            latitude,
            longitude,
            accuracy: accuracy ?? undefined,
            heading: heading ?? undefined,
            speed: speed ?? undefined,
            recordedAt: pos.timestamp || Date.now(),
          },
        ],
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.authToken) {
        headers["Authorization"] = `Bearer ${this.authToken}`;
      }

      await fetchWithTimeout(`${API_BASE_URL}/sync/locations`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeout: 10000,
      });
    } catch (err) {
      // Quietly log location sample failure
      logger.warn("[LocationTracker] Failed to record location point:", err);
    }
  }
}

export const locationTracker = new LocationTrackerService();
