/**
 * API configuration for backend server
 *
 * In development (expo start), the app points to localhost:3000 so you can
 * run the backend locally. If you need to test on a physical device, set
 * EXPO_PUBLIC_API_URL in Locate720/.env.local to your machine's LAN IP,
 * e.g. EXPO_PUBLIC_API_URL=http://192.168.1.100:3000/api
 *
 * In preview/production builds, the app always points to the OVH server
 * so it works from anywhere without your dev machine running.
 */
const DEV_API_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

const PROD_API_URL = 'http://15.204.247.173:3000/api';

export const API_BASE_URL = __DEV__ ? DEV_API_URL : PROD_API_URL;

export const ENDPOINTS = {
  tickets: '/tickets',
  users: '/users',
  health: '/health',
  syncEvents: '/sync/events',
  syncPull: '/sync/pull',
  timesheetEvents: '/timesheet/events',
  timesheetSummary: '/timesheet/summary',
  syncNotes: '/sync/notes',
};
