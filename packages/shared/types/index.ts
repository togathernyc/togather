// Shared TypeScript types between backend and frontend

export interface User {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
  date_joined?: string;
}

export interface Group {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Chat {
  id: number;
  name?: string;
  participants?: User[];
  last_message?: Message;
  created_at?: string;
}

export interface Message {
  id: number;
  content: string;
  sender: User;
  chat: number;
  created_at: string;
}

export interface ApiResponse<T> {
  data: T;
  errors?: string[];
  page_info?: {
    current_page: number;
    total_pages: number;
    total_items: number;
  };
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

