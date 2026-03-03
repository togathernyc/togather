/**
 * User types shared across mobile and web
 */

export interface User {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  profile_photo?: string;
  is_admin?: boolean;
  [key: string]: any; // Allow additional user properties
}

