/**
 * Community types shared across mobile and web
 */

export interface Community {
  id: string | number;
  name?: string;
  subdomain?: string;
  logo?: string; // Community logo URL (S3 URL or relative path)
  [key: string]: any; // Allow additional community properties
}
