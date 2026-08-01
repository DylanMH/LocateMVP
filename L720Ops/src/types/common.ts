export type SortDirection = 'asc' | 'desc';
export type SortField = string;

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface FilterOption {
  label: string;
  value: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface TableColumn<T = unknown> {
  key: keyof T;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  render?: (value: unknown, item: T) => React.ReactNode;
}

export interface ActionItem {
  label: string;
  action: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
}

export interface LoadingState {
  isLoading: boolean;
  error?: string;
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'select' | 'textarea' | 'number' | 'date';
  required?: boolean;
  placeholder?: string;
  options?: SelectOption[];
  validation?: (value: unknown) => string | null;
}

export interface NotificationItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

export interface ActivityItem {
  id: string;
  type: string;
  description: string;
  timestamp: number;
  userId?: string;
  userName?: string;
  metadata?: Record<string, unknown>;
}
