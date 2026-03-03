/**
 * Reserved slugs that cannot be used for custom channels
 */
export const RESERVED_SLUGS = ['general', 'leaders', 'reach-out', 'create', 'settings', 'members'];

/**
 * Generate a URL-friendly slug from a channel name
 * Handles collisions by appending -2, -3, etc.
 *
 * @param name - The channel name to convert to a slug
 * @param existingSlugs - Array of existing slugs to check for collisions
 * @returns A unique, URL-friendly slug
 *
 * @example
 * generateChannelSlug('Directors', []) // 'directors'
 * generateChannelSlug('BK Sunday Service', []) // 'bk-sunday-service'
 * generateChannelSlug('Create', []) // 'create-channel' (reserved)
 * generateChannelSlug('Directors', ['directors']) // 'directors-2'
 */
export function generateChannelSlug(name: string, existingSlugs: string[]): string {
  // 1. Lowercase the name
  // 2. Replace non-alphanumeric with hyphens
  // 3. Remove leading/trailing hyphens
  // 4. Truncate to 45 chars (leaving room for collision suffix like -999)
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 45);

  // 5. Handle empty slug (name was only special characters)
  //    Use a default slug that will be made unique if needed
  if (base.length === 0) {
    base = 'channel';
  }

  // 6. If reserved, append "-channel"
  if (RESERVED_SLUGS.includes(base)) {
    base = `${base}-channel`;
  }

  // 7. If collision, append -2, -3, etc. (case-insensitive check)
  const lowerSlugs = existingSlugs.map((s) => s.toLowerCase());
  let slug = base;
  let counter = 2;

  while (lowerSlugs.includes(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }

  // Ensure final slug doesn't exceed 50 chars (safety check)
  return slug.slice(0, 50);
}

/**
 * Validate a slug format
 *
 * A valid slug:
 * - Contains only lowercase letters, numbers, and hyphens
 * - Does not start or end with a hyphen
 * - Does not have consecutive hyphens
 * - Is at most 50 characters long
 *
 * @param slug - The slug to validate
 * @returns true if the slug is valid, false otherwise
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 50;
}

/**
 * Get the URL-friendly slug for a channel.
 *
 * This handles backwards compatibility for channels that don't have a slug:
 * - If the channel has a slug, use it
 * - For "main" channels without a slug, return "general" (the URL-friendly name)
 * - For "leaders" channels without a slug, return "leaders"
 * - For other channels without a slug, return the channelType
 *
 * @param channel - Object with optional slug and channelType
 * @returns The URL-friendly slug for the channel
 */
export function getChannelSlug(channel: { slug?: string; channelType: string }): string {
  if (channel.slug) {
    return channel.slug;
  }
  // For backwards compatibility: main channel should have URL slug "general", not "main"
  if (channel.channelType === "main") {
    return "general";
  }
  return channel.channelType;
}
