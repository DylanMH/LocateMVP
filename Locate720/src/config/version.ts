/**
 * App version — single source of truth for the Locate720 mobile app.
 *
 * Update this constant when bumping versions.  We keep it here rather
 * than reading from package.json (Metro can't resolve JSON imports from
 * the app/ directory) or Constants.expoConfig.version (baked into the
 * dev build at compile time and doesn't update without a rebuild).
 */
export const APP_VERSION = "1.7.0";
