/**
 * Seed database with sample tickets on first run
 * 
 * NOTE: This function is now disabled. All ticket data comes from the backend server
 * via the SyncEngine. The backend generates realistic 811-style tickets with proper
 * marking instructions, contractor info, work types, and contact details.
 * 
 * To get tickets, ensure the backend is running and the app will automatically
 * fetch assigned tickets on first sync.
 */
export async function seedDatabaseIfEmpty() {
  console.log('[Seed] Local seeding disabled - all data comes from backend server');
  console.log('[Seed] Run backend server and app will sync tickets automatically');
  
  // No-op: Backend provides all data
  return;
}
