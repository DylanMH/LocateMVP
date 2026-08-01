/**
 * Dev session - reads from auth context
 * Later will be replaced with Microsoft login
 */

// This is now a fallback - auth should be used via AuthContext
// Keeping for compatibility with code that doesn't have auth context access
let _cachedUser: { id: string; name: string; role: string } | null = null;

export function setCurrentUser(user: { id: string; name: string; role: string } | null) {
  _cachedUser = user;
}

export function getCurrentUserId(): string {
  if (!_cachedUser) {
    throw new Error('No user logged in - use AuthContext instead');
  }
  return _cachedUser.id;
}

export function getCurrentUser() {
  if (!_cachedUser) {
    throw new Error('No user logged in - use AuthContext instead');
  }
  return _cachedUser;
}
