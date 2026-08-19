/**
 * API configuration for backend server
 *
 * The app points to the OVH server via nginx (port 80) which proxies
 * to the backend on port 3000. Port 3000 is not exposed externally.
 *
 * To use a local backend for development:
 *   1. Set EXPO_PUBLIC_API_URL in Locate720/.env.local:
 *      EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:3000/api
 *   2. Rebuild the dev client: npx expo run:android (or ios)
 *      (Env vars are baked into the dev build at compile time.)
 */

const OVH_API_URL = 'http://15.204.247.173/api';

// EXPO_PUBLIC_API_URL is baked into the dev build at compile time.
// If a stale localhost value is cached, fall back to OVH.
const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL;
const DEV_API_URL = ENV_API_URL && !ENV_API_URL.includes('localhost')
  ? ENV_API_URL
  : OVH_API_URL;

export const API_BASE_URL = __DEV__ ? DEV_API_URL : OVH_API_URL;

export const ENDPOINTS = {
  tickets: '/tickets',
  users: '/users',
  health: '/health',
  syncEvents: '/sync/events',
  syncPull: '/sync/pull',
  timesheetEvents: '/timesheet/events',
  timesheetSummary: '/timesheet/summary',
  timesheetSync: '/timesheet/sync',
  syncNotes: '/sync/notes',
};
