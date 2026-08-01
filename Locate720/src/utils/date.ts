/**
 * Date formatting utilities for Locate720.
 * Formats timestamps for ticket due dates, times, and other date displays.
 */

/**
 * Formats a timestamp to MM/DD · h:mm AM/PM format.
 * Uses device local timezone.
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted string like "16/01 · 6:11 PM" or "No due date" if no timestamp
 */
export function formatDueDateTime(timestamp?: number): string {
  if (!timestamp) return 'No due date';
  const date = new Date(timestamp);
  
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  
  return `${day}/${month} · ${displayHours}:${minutes} ${ampm}`;
}

/**
 * Formats a timestamp to h:mm AM/PM format only.
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted time string like "6:11 PM"
 */
export function formatTime(timestamp?: number): string {
  if (!timestamp) return "N/A";
  
  const date = new Date(timestamp);
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  
  hours = hours % 12;
  hours = hours ? hours : 12;
  
  return `${hours}:${minutes} ${ampm}`;
}

/**
 * Formats a timestamp to MM/DD format only.
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date string like "01/16"
 */
export function formatDate(timestamp?: number): string {
  if (!timestamp) return "N/A";
  
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${month}/${day}`;
}
