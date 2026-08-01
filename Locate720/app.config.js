const fs = require("fs");
const path = require("path");

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, ".env.local");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

const googleMapsApiKey = process.env.LOCATE720_GOOGLE_MAPS_ANDROID_API_KEY || "";
const buildCommand = process.env.EAS_BUILD || process.env.CI || process.env.EXPO_PUBLIC_BUILD_PROFILE;

if (!googleMapsApiKey && buildCommand) {
  throw new Error(
    "Missing LOCATE720_GOOGLE_MAPS_ANDROID_API_KEY. Set it in EAS environment variables for the selected build profile or in a local .env file for local builds.",
  );
}

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []).filter((plugin) => {
      if (typeof plugin === "string") {
        return plugin !== "react-native-maps";
      }

      return plugin?.[0] !== "react-native-maps";
    }),
    [
      "react-native-maps",
      {
        androidGoogleMapsApiKey: googleMapsApiKey,
      },
    ],
  ],
});
