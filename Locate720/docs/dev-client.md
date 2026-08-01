
# Expo Dev Client Setup

This app now uses **Expo Dev Client** instead of Expo Go to enable native features like WatermelonDB with SQLite persistence.

## Why Dev Client?

Expo Go is limited to a predefined set of native modules. To use WatermelonDB with SQLite/JSI for production-ready database persistence, we need a custom dev client build.

## Initial Setup (After Clone or Fresh Install)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Prebuild native projects:**
   ```bash
   npx expo prebuild
   ```
   This generates the `android/` and `ios/` folders with native code.

3. **Build and install dev client on device/emulator:**

   **For Android:**
   ```bash
   npx expo run:android
   ```
   This builds the app and installs it on your connected device/emulator.

   **For iOS (macOS only):**
   ```bash
   npx expo run:ios
   ```

4. **Start the Metro bundler:**
   ```bash
   npx expo start --dev-client
   ```

5. **Open the custom dev client app (NOT Expo Go) on your device.**

## Daily Development Workflow

After the initial setup, you typically only need:

```bash
npx expo start --dev-client
```

Then open the **Locate720 dev client app** (not Expo Go) on your device.

## When to Rebuild

You need to rebuild the native app when:
- Adding/removing native modules
- Changing `app.json` plugins
- Modifying native code in `android/` or `ios/`

To rebuild:
```bash
npx expo prebuild --clean
npx expo run:android  # or run:ios
```

## Troubleshooting

**"Cannot find module '@nozbe/watermelondb'"**
- Make sure you ran `npm install`
- Try clearing Metro cache: `npx expo start --clear`

**"Database setup error"**
- Check that the WatermelonDB Expo plugin is in `app.json`
- Rebuild the native app: `npx expo prebuild --clean && npx expo run:android`

**"App not found" or using Expo Go by mistake**
- Make sure you installed the dev client with `npx expo run:android`
- Open the **Locate720** app (custom icon), NOT Expo Go

## Tech Stack

- **WatermelonDB** with SQLite adapter (JSI enabled)
- **Expo Router** for navigation
- **NativeWind** for styling
- **Expo Dev Client** for custom native modules
