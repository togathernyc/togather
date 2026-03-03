/**
 * Generate a unique ID for messages and other entities.
 * Uses timestamp + random string for uniqueness.
 */
export const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${randomPart}`;
};
