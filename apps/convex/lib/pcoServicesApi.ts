/**
 * PCO Services API Client
 *
 * Provides typed access to Planning Center Services API endpoints.
 * Used for Auto Channels feature to fetch service types, teams, plans, and team members.
 *
 * Rate limit: PCO allows 100 requests per 20 seconds.
 * We use 80 requests per 20 seconds to be conservative.
 */

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { isTokenExpired } from "./utils";

const PCO_SERVICES_BASE = "https://api.planningcenteronline.com/services/v2";
const PCO_PEOPLE_BASE = "https://api.planningcenteronline.com/people/v2";
const PCO_OAUTH_TOKEN_URL = "https://api.planningcenteronline.com/oauth/token";

// Rate limit: PCO allows 100 requests per 20 seconds
// We batch API calls with BATCH_SIZE=15 in actions.ts and rotation.ts to stay well under this limit

// ============================================================================
// Error Types
// ============================================================================

export class PcoApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public response?: unknown
  ) {
    super(message);
    this.name = "PcoApiError";
  }
}

// ============================================================================
// Token Management
// ============================================================================

interface PlanningCenterTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  created_at: number;
  scope?: string;
}

/**
 * Get Planning Center credentials from environment
 */
function getPlanningCenterCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.PLANNING_CENTER_CLIENT_ID;
  const clientSecret = process.env.PLANNING_CENTER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Planning Center OAuth credentials not configured");
  }

  return { clientId, clientSecret };
}

/**
 * Get a valid access token for PCO API calls.
 * Refreshes the token if it's expired or about to expire.
 */
export async function getValidAccessToken(
  ctx: ActionCtx,
  communityId: Id<"communities">
): Promise<string> {
  // Get the community's PCO integration
  const integration = await ctx.runQuery(
    internal.functions.pcoServices.queries.getIntegration,
    { communityId }
  );

  if (!integration) {
    throw new PcoApiError(401, "Community not connected to Planning Center");
  }

  if (integration.status !== "connected") {
    throw new PcoApiError(401, "Planning Center integration is not active");
  }

  const credentials = integration.credentials as PlanningCenterTokens | null;
  if (!credentials?.access_token) {
    throw new PcoApiError(401, "No valid access token for Planning Center");
  }

  // Check if token needs refresh (expires in less than 5 minutes)
  const needsRefresh = isTokenExpired(
    credentials.created_at,
    credentials.expires_in
  );

  if (needsRefresh && credentials.refresh_token) {
    // Refresh the token
    const refreshed = await refreshAccessToken(
      ctx,
      communityId,
      credentials.refresh_token
    );
    return refreshed.accessToken;
  }

  return credentials.access_token;
}

/**
 * Refresh the PCO access token using the refresh token.
 */
async function refreshAccessToken(
  ctx: ActionCtx,
  communityId: Id<"communities">,
  refreshToken: string
): Promise<{ accessToken: string }> {
  const { clientId, clientSecret } = getPlanningCenterCredentials();

  const refreshResponse = await fetch(PCO_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!refreshResponse.ok) {
    // Mark integration as error
    await ctx.runMutation(internal.functions.integrations.markIntegrationError, {
      communityId,
      error: "Token refresh failed",
    });
    throw new PcoApiError(
      refreshResponse.status,
      "Failed to refresh Planning Center access token"
    );
  }

  const newTokens: PlanningCenterTokens = await refreshResponse.json();

  // Store the refreshed tokens using existing mutation
  await ctx.runMutation(
    internal.functions.integrations.updateIntegrationCredentials,
    {
      communityId,
      credentials: newTokens,
    }
  );

  return { accessToken: newTokens.access_token };
}

// ============================================================================
// Generic Fetch Helper
// ============================================================================

/**
 * Make an authenticated request to PCO API with error handling.
 */
export async function pcoFetch<T>(
  accessToken: string,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new PcoApiError(
      response.status,
      `PCO API error: ${response.statusText}`,
      errorBody
    );
  }

  // DELETE returns 204 No Content — no body to parse
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// ============================================================================
// Service Types API
// ============================================================================

export interface PcoServiceTypesResponse {
  data: Array<{
    id: string;
    type: "ServiceType";
    attributes: {
      name: string;
      sequence: number;
      deleted_at: string | null;
    };
  }>;
}

/**
 * Fetch all service types for the organization.
 * GET /services/v2/service_types
 */
export async function fetchServiceTypes(
  accessToken: string
): Promise<PcoServiceTypesResponse["data"]> {
  const url = `${PCO_SERVICES_BASE}/service_types`;
  const response = await pcoFetch<PcoServiceTypesResponse>(accessToken, url);
  return response.data.filter((st) => !st.attributes.deleted_at);
}

// ============================================================================
// Teams API
// ============================================================================

export interface PcoTeamsResponse {
  data: Array<{
    id: string;
    type: "Team";
    attributes: {
      name: string;
      sequence: number;
      schedule_to: string;
    };
  }>;
}

/**
 * Fetch all teams for a service type.
 * GET /services/v2/service_types/{id}/teams
 */
export async function fetchTeamsForServiceType(
  accessToken: string,
  serviceTypeId: string
): Promise<PcoTeamsResponse["data"]> {
  const url = `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/teams`;
  const response = await pcoFetch<PcoTeamsResponse>(accessToken, url);
  return response.data;
}

// ============================================================================
// Plans API
// ============================================================================

export interface PcoPlansResponse {
  data: Array<{
    id: string;
    type: "Plan";
    attributes: {
      title: string;
      sort_date: string;
      dates: string;
      series_title: string | null;
    };
  }>;
}

/**
 * Fetch upcoming plans for a service type.
 * GET /services/v2/service_types/{id}/plans?filter=future&order=sort_date
 */
export async function fetchUpcomingPlans(
  accessToken: string,
  serviceTypeId: string,
  limit: number = 10
): Promise<PcoPlansResponse["data"]> {
  const url = `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans?filter=future&order=sort_date&per_page=${limit}`;
  const response = await pcoFetch<PcoPlansResponse>(accessToken, url);
  return response.data;
}

/**
 * Fetch past plans for a service type within a date range.
 * GET /services/v2/service_types/{id}/plans?filter=past&order=-sort_date&per_page={limit}
 *
 * Returns plans in reverse chronological order (most recent first).
 * Use `after` param (ISO date string) to limit how far back to look.
 */
export async function fetchPastPlans(
  accessToken: string,
  serviceTypeId: string,
  options?: { after?: string; limit?: number }
): Promise<PcoPlansResponse["data"]> {
  const limit = options?.limit ?? 25;
  let url = `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans?filter=past&order=-sort_date&per_page=${limit}`;
  if (options?.after) {
    url += `&after=${options.after}`;
  }
  const response = await pcoFetch<PcoPlansResponse>(accessToken, url);
  return response.data;
}

// ============================================================================
// Team Members API
// ============================================================================

export interface PcoTeamMembersResponse {
  data: Array<{
    id: string;
    type: "PlanPerson";
    attributes: {
      name: string;
      status: string;
      team_position_name: string | null;
    };
    relationships?: {
      person?: { data: { id: string; type: "Person" } };
      team?: { data: { id: string; type: "Team" } };
    };
  }>;
  included?: Array<{
    id: string;
    type: string;
    attributes: Record<string, unknown>;
  }>;
  links?: {
    self?: string;
    next?: string;
  };
}

export interface PlanTeamMemberWithTeam {
  id: string;
  name: string;
  status: string;
  position: string | null;
  pcoPersonId: string | null;
  teamId: string | null;
  teamName: string | null;
}

/**
 * Fetch team members for a specific plan.
 * GET /services/v2/service_types/{stId}/plans/{planId}/team_members?include=person,team
 *
 * Handles pagination automatically - follows links.next until all team members are fetched.
 * Returns enriched data including team names from the included resources.
 *
 * @param teamIds - Optional array of team IDs to filter by. If empty/null, returns all teams.
 */
export async function fetchPlanTeamMembers(
  accessToken: string,
  serviceTypeId: string,
  planId: string,
  teamIds?: string[]
): Promise<PlanTeamMemberWithTeam[]> {
  const allMembers: PcoTeamMembersResponse["data"] = [];
  const teamLookup: Map<string, string> = new Map(); // teamId -> teamName
  let nextUrl: string | undefined = `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans/${planId}/team_members?include=person,team&per_page=100`;

  // Paginate through all results
  while (nextUrl) {
    const response: PcoTeamMembersResponse = await pcoFetch<PcoTeamMembersResponse>(accessToken, nextUrl);
    allMembers.push(...response.data);

    // Extract team names from included data
    if (response.included) {
      for (const item of response.included) {
        if (item.type === "Team" && item.attributes.name) {
          teamLookup.set(item.id, item.attributes.name as string);
        }
      }
    }

    // Check if there are more pages
    nextUrl = response.links?.next;
  }

  // Transform to enriched format
  let enrichedMembers: PlanTeamMemberWithTeam[] = allMembers.map((member) => {
    const teamId = member.relationships?.team?.data?.id || null;
    return {
      id: member.id,
      name: member.attributes.name,
      status: member.attributes.status,
      position: member.attributes.team_position_name,
      pcoPersonId: member.relationships?.person?.data?.id || null,
      teamId,
      teamName: teamId ? teamLookup.get(teamId) || null : null,
    };
  });

  // Filter by team IDs if specified
  if (teamIds && teamIds.length > 0) {
    enrichedMembers = enrichedMembers.filter((member) => {
      return member.teamId && teamIds.includes(member.teamId);
    });
  }

  return enrichedMembers;
}

// ============================================================================
// Person Contact Info API
// ============================================================================

export interface PcoPersonResponse {
  data: {
    id: string;
    type: "Person";
    attributes: {
      first_name: string;
      last_name: string;
    };
  };
  included?: Array<{
    id: string;
    type: "PhoneNumber" | "Email";
    attributes: {
      number?: string;
      address?: string;
      primary?: boolean;
    };
  }>;
}

/**
 * Get contact info for a person from PCO People API.
 * GET /people/v2/people/{id}?include=phone_numbers,emails
 */
export async function getPersonContactInfo(
  accessToken: string,
  pcoPersonId: string
): Promise<{ name: string; phone: string | null; email: string | null }> {
  const url = `${PCO_PEOPLE_BASE}/people/${pcoPersonId}?include=phone_numbers,emails`;

  try {
    const response = await pcoFetch<PcoPersonResponse>(accessToken, url);

    // Get name from response
    const firstName = response.data.attributes.first_name || "";
    const lastName = response.data.attributes.last_name || "";
    const name = `${firstName} ${lastName}`.trim() || "Unknown";

    let phone: string | null = null;
    let email: string | null = null;

    if (response.included) {
      // Find primary phone or first phone
      const phones = response.included.filter(
        (i): i is (typeof response.included)[number] & { type: "PhoneNumber" } =>
          i.type === "PhoneNumber"
      );
      const primaryPhone = phones.find((p) => p.attributes.primary);
      phone = (primaryPhone || phones[0])?.attributes.number || null;

      // Find primary email or first email
      const emails = response.included.filter(
        (i): i is (typeof response.included)[number] & { type: "Email" } =>
          i.type === "Email"
      );
      const primaryEmail = emails.find((e) => e.attributes.primary);
      email = (primaryEmail || emails[0])?.attributes.address || null;
    }

    return { name, phone, email };
  } catch (error) {
    // Person might not exist in People, return nulls
    if (error instanceof PcoApiError && error.status === 404) {
      return { name: "Unknown", phone: null, email: null };
    }
    throw error;
  }
}

// ============================================================================
// People Search API
// ============================================================================

interface PcoPeopleSearchResponse {
  data: Array<{
    id: string;
    type: "Person";
    attributes: {
      first_name: string;
      last_name: string;
    };
  }>;
}

/**
 * Search PCO People by name.
 * GET /people/v2/people?where[search_name]=<name>
 *
 * Returns matching person records. PCO searches across first/last names.
 */
export async function searchPeopleByName(
  accessToken: string,
  name: string
): Promise<Array<{ id: string; firstName: string; lastName: string }>> {
  const params = new URLSearchParams({
    "where[search_name]": name,
    per_page: "5",
  });
  const url = `${PCO_PEOPLE_BASE}/people?${params}`;
  const response = await pcoFetch<PcoPeopleSearchResponse>(accessToken, url);
  return response.data.map((p) => ({
    id: p.id,
    firstName: p.attributes.first_name,
    lastName: p.attributes.last_name,
  }));
}

// ============================================================================
// Plan Items API (for Run Sheet feature)
// ============================================================================

/**
 * PCO Plan Item - represents a single item in a service plan (song, header, media, etc.)
 */
export interface PcoPlanItem {
  id: string;
  type: string;
  attributes: {
    title: string;
    description: string | null;
    item_type: string; // "song", "header", "media", "item"
    length: number | null;
    service_position: string | null;
    sequence: number;
    created_at: string;
    updated_at: string;
    html_details: string | null;
    // Key can be set per-item, overriding the arrangement's default
    key_name: string | null;
  };
  relationships?: {
    song?: { data: { id: string; type: string } | null };
    arrangement?: { data: { id: string; type: string } | null };
    item_notes?: { data: Array<{ id: string; type: string }> };
    item_times?: { data: Array<{ id: string; type: string }> };
  };
}

/**
 * PCO Song - song details from the included resources
 */
export interface PcoSong {
  id: string;
  type: string;
  attributes: {
    title: string;
    ccli_number: string | null;
    author: string | null;
  };
}

/**
 * PCO Arrangement - arrangement details for a song
 */
export interface PcoArrangement {
  id: string;
  type: string;
  attributes: {
    name: string;
    bpm: number | null;
    length: number | null;
    meter: string | null;
    chord_chart_key: string | null;
  };
}

/**
 * PCO Item Note - notes attached to a plan item
 */
export interface PcoItemNote {
  id: string;
  type: string;
  attributes: {
    category_name: string;
    content: string | null;
    created_at: string;
  };
}

/**
 * PCO Item Time - scheduled times for a plan item
 */
export interface PcoItemTime {
  id: string;
  type: string;
  attributes: {
    time_type: string; // "actual", "scheduled", etc.
    starts_at: string | null;
    team_position_name: string | null;
  };
}

/**
 * PCO Attachment - attachments linked to a plan item (files, links, etc.)
 */
export interface PcoAttachment {
  id: string;
  type: "Attachment";
  attributes: {
    filename: string;
    url: string;
    content_type: string;
    created_at: string;
    web_streamable: boolean | null;
    downloadable: boolean;
    linked_url: string | null;
    pco_type: string; // e.g., "AttachmentTypes::Spotify", "AttachmentTypes::GoogleDrive"
  };
}

/**
 * PCO All Attachments Response - response from the all_attachments endpoint
 * This endpoint returns all attachments for a plan, including item-level attachments
 */
export interface PcoAllAttachmentsResponse {
  data: Array<{
    id: string;
    type: "Attachment";
    attributes: {
      filename: string;
      url: string;
      content_type: string;
      created_at: string;
      web_streamable: boolean | null;
      downloadable: boolean;
      linked_url: string | null;
      pco_type: string;
      attachable_type: string; // "Item", "Plan", etc.
      attachable_id: string; // The ID of the item/plan this is attached to
    };
  }>;
}

/**
 * PCO Plan Items Response - typed response for plan items endpoint
 */
export interface PcoPlanItemsResponse {
  data: PcoPlanItem[];
  included?: Array<PcoSong | PcoArrangement | PcoItemNote | PcoItemTime>;
}

/**
 * Fetch plan items for a specific plan with related resources.
 * GET /services/v2/service_types/{stId}/plans/{planId}/items?include=song,arrangement,item_notes,item_times
 *
 * Note: Attachments are NOT included in this response. They must be fetched
 * separately using fetchPlanAllAttachments.
 *
 * Handles pagination to fetch ALL items (PCO defaults to 25 per page, max 100).
 *
 * @param accessToken - Valid PCO access token
 * @param serviceTypeId - PCO Service Type ID
 * @param planId - PCO Plan ID
 * @returns Plan items with songs, arrangements, notes, and times
 */
export async function fetchPlanTimes(
  accessToken: string,
  serviceTypeId: string,
  planId: string
): Promise<Array<{ id: string; startsAt: string | null; timeType: string; name: string }>> {
  const url = `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans/${planId}/plan_times`;
  const response = await pcoFetch<{
    data: Array<{
      id: string;
      attributes: {
        starts_at: string | null;
        name: string;
        time_type: string; // "rehearsal", "service", "other"
      };
    }>;
  }>(accessToken, url);

  return response.data.map((pt) => ({
    id: pt.id,
    startsAt: pt.attributes.starts_at,
    timeType: pt.attributes.time_type,
    name: pt.attributes.name,
  }));
}

export async function fetchPlanItems(
  accessToken: string,
  serviceTypeId: string,
  planId: string
): Promise<PcoPlanItemsResponse> {
  const allItems: PcoPlanItem[] = [];
  const allIncluded: Array<PcoSong | PcoArrangement | PcoItemNote | PcoItemTime> = [];

  let nextUrl: string | undefined = `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans/${planId}/items?include=song,arrangement,item_notes,item_times&per_page=100`;

  // Paginate through all results
  type PlanItemsPageResponse = PcoPlanItemsResponse & { links?: { next?: string } };
  while (nextUrl) {
    const response: PlanItemsPageResponse = await pcoFetch<PlanItemsPageResponse>(accessToken, nextUrl);
    allItems.push(...response.data);

    if (response.included) {
      allIncluded.push(...response.included);
    }

    // Check if there are more pages
    nextUrl = response.links?.next;
  }

  return {
    data: allItems,
    included: allIncluded.length > 0 ? allIncluded : undefined,
  };
}

/**
 * Fetch all attachments for a plan.
 * GET /services/v2/service_types/{stId}/plans/{planId}/all_attachments
 *
 * This endpoint returns ALL attachments for the plan, including those attached
 * to individual items. Use attachable_type and attachable_id to link attachments
 * back to their parent items.
 *
 * Handles pagination to fetch ALL attachments.
 *
 * @param accessToken - Valid PCO access token
 * @param serviceTypeId - PCO Service Type ID
 * @param planId - PCO Plan ID
 * @returns All attachments for the plan
 */
export async function fetchPlanAllAttachments(
  accessToken: string,
  serviceTypeId: string,
  planId: string
): Promise<PcoAllAttachmentsResponse> {
  const allAttachments: PcoAllAttachmentsResponse["data"] = [];

  let nextUrl: string | undefined = `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans/${planId}/all_attachments?per_page=100`;

  // Paginate through all results
  type AttachmentsPageResponse = PcoAllAttachmentsResponse & { links?: { next?: string } };
  while (nextUrl) {
    const response: AttachmentsPageResponse = await pcoFetch<AttachmentsPageResponse>(accessToken, nextUrl);
    allAttachments.push(...response.data);

    // Check if there are more pages
    nextUrl = response.links?.next;
  }

  return { data: allAttachments };
}

/**
 * Fetch team members assigned to a plan (for run sheet display).
 * Returns team members with their team names.
 *
 * @param accessToken - Valid PCO access token
 * @param serviceTypeId - PCO Service Type ID
 * @param planId - PCO Plan ID
 * @returns Array of team members with name, status, position, and team info
 */
export async function fetchPlanTeamMembersForItems(
  accessToken: string,
  serviceTypeId: string,
  planId: string
): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    teamPositionName: string | null;
    teamName: string | null;
  }>
> {
  // Fetch all team members for the plan with team included
  const url = `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans/${planId}/team_members?include=team`;
  const response = await pcoFetch<{
    data: Array<{
      id: string;
      type: string;
      attributes: {
        name: string;
        status: string;
        team_position_name: string | null;
      };
      relationships?: {
        team?: { data: { id: string; type: string } | null };
      };
    }>;
    included?: Array<{
      id: string;
      type: string;
      attributes: { name: string };
    }>;
  }>(accessToken, url);

  // Build team lookup from included resources
  const teamLookup = new Map<string, string>();
  for (const item of response.included ?? []) {
    if (item.type === "Team") {
      teamLookup.set(item.id, item.attributes.name);
    }
  }

  return response.data.map((member) => ({
    id: member.id,
    name: member.attributes.name,
    status: member.attributes.status,
    teamPositionName: member.attributes.team_position_name,
    teamName: member.relationships?.team?.data
      ? teamLookup.get(member.relationships.team.data.id) ?? null
      : null,
  }));
}
