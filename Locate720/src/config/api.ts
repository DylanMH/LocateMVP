/**
 * API configuration for backend server
 */

// Development backend URL — change to your computer's local IP when
// testing on a physical device (localhost doesn't work from device).
// Preview/production builds point to the OVH server.
export const API_BASE_URL = __DEV__
  ? 'http://192.168.50.245:3000/api'  // Replace with your local IP
  : 'http://15.204.247.173:3000/api';  // OVH server

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
