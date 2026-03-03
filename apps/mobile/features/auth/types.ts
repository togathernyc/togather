// Auth Feature Types

import type { Community } from "@/types/shared";

// Re-export Community for convenience
export type { Community };

export interface SignInCredentials {
  email: string;
  password: string;
  communityId?: string | number;
}

export interface SignUpData {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  email: string;
  password: string;
  zip_code?: string;
  location: string | number;
  country: string;
  community: string | number;
}

export interface PasswordResetData {
  key: string;
  new_password: string;
  confirm_new_password: string;
}

export type AuthError = string | Error;

export interface CommunitySearchResult {
  id: string | number;
  name: string;
  subdomain?: string;
  [key: string]: any;
}

export interface RegisterResult {
  // Legacy fields from Django API
  success?: boolean;
  message?: string;
  // Convex API returns these directly
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    phoneVerified: boolean;
  };
}

