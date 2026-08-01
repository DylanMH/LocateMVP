/**
 * API configuration for backend server
 */

// Development backend URL
// Change to your computer's local IP when testing on physical device
// (localhost doesn't work from physical device)
export const API_BASE_URL = __DEV__
  ? 'http://192.168.50.245:3000/api'  // Replace with your local IP
  : 'https://api.locate720.com/api';  // Production URL (future)

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

// Test user ID for development
export const DEV_USER_ID = 'user-bob-123';
