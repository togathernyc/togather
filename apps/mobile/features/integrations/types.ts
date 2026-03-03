/**
 * TypeScript types for third-party integrations.
 *
 * @see Backend schemas: apps/backend/src/servers/togather_api/schemas/integrations.py
 */

/**
 * Integration status enum values.
 */
export type IntegrationStatus = 'active' | 'expired' | 'error' | 'disconnected';

/**
 * Integration type enum values.
 */
export type IntegrationType = 'planning_center';

/**
 * Integration record with connection details.
 *
 * @see Backend schema: IntegrationOut
 */
export interface Integration {
  id: number;
  integration_type: IntegrationType;
  status: IntegrationStatus;
  connected_by: number | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Available integration type with metadata.
 *
 * @see Backend schema: AvailableIntegrationOut
 */
export interface AvailableIntegration {
  type: IntegrationType;
  display_name: string;
  description: string;
  logo_url: string | null;
  is_connected: boolean;
}

/**
 * Planning Center authorization request.
 *
 * @see Backend schema: PlanningCenterAuthorizeIn
 */
export interface PlanningCenterAuthorizeRequest {
  redirect_uri?: string;
}

/**
 * Planning Center authorization response.
 *
 * @see Backend schema: PlanningCenterAuthorizeOut
 */
export interface PlanningCenterAuthorizeResponse {
  authorization_url: string;
}

/**
 * Integration connection status details.
 *
 * @see Backend schema: IntegrationStatusOut
 */
export interface IntegrationStatusDetails {
  is_connected: boolean;
  status: IntegrationStatus;
  last_sync_at: string | null;
  last_error: string | null;
  token_expires_at: string | null;
  is_token_expired: boolean;
}
