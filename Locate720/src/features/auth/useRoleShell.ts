import { UserRole } from './AuthContext';

export type RoleShell = 'tech' | 'supervisor' | 'manager';

export function getRoleShell(role: UserRole | undefined): RoleShell {
  if (!role) return 'tech';
  if (role === 'SUPERVISOR') return 'supervisor';
  if (role === 'AREA_MANAGER' || role === 'DISTRICT_MANAGER') return 'manager';
  return 'tech'; // TRAINEE, TRAINER, TECH
}
