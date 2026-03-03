/**
 * Report types shared across mobile and web
 */

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

