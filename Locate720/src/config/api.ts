/**
 * API configuration for backend server
 *
 * In development (expo start), the app points to the OVH server via nginx
 * (port 80) which proxies to the backend on port 3000. Port 3000 is not
 * exposed externally. To use a local backend instead, set
 * EXPO_PUBLIC_API_URL in Locate720/.env.local:
 *   EXPO_PUBLIC_API_URL=http://localhost:3000/api
 *
 * In preview/production builds, the app always points to the OVH server
 * so it works from anywhere without your dev machine running.
 */
const DEV_API_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://15.204.247.173/api';

const PROD_API_URL = 'http://15.204.247.173/api';

export const API_BASE_URL = __DEV__ ? DEV_API_URL : PROD_API_URL;

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
