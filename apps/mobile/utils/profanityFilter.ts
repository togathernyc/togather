/**
 * Profanity filter utility for chat messages.
 * Used to comply with App Store Guideline 1.2 requiring content filtering.
 *
 * This module provides a centralized way to check messages for inappropriate
 * content before they are sent to the chat system.
 */

import { Filter } from 'bad-words';

// Create a singleton filter instance with default profanity list
const filter = new Filter();

// Remove words that are commonly used in religious contexts
// The default bad-words list includes some terms that are normal in church settings
// Note: bad-words stores all words in lowercase internally, so we must use lowercase here
filter.removeWords('god', 'hell', 'damn', 'crap', 'jesus', 'christ');

// Note: The filter still blocks severe profanity like f-words, s-words, etc.
// The removeWords above just allows common expressions in religious contexts.

/**
 * Check if a message contains profanity.
 * @param text - The message text to check
 * @returns true if the message contains profanity, false otherwise
 */
export function containsProfanity(text: string): boolean {
  if (!text || text.trim().length === 0) {
    return false;
  }

  try {
    return filter.isProfane(text);
  } catch (error) {
    // If there's an error checking, err on the side of allowing the message
    console.error('[ProfanityFilter] Error checking message:', error);
    return false;
  }
}

/**
 * Clean a message by replacing profane words with asterisks.
 * Note: This app uses blocking (not censoring), but this is available if needed.
 * @param text - The message text to clean
 * @returns The cleaned message with profane words replaced
 */
export function cleanMessage(text: string): string {
  if (!text || text.trim().length === 0) {
    return text;
  }

  try {
    return filter.clean(text);
  } catch (error) {
    console.error('[ProfanityFilter] Error cleaning message:', error);
    return text;
  }
}

/**
 * Message shown to user when their message is blocked due to profanity.
 */
export const PROFANITY_ALERT_TITLE = 'Message Not Sent';
export const PROFANITY_ALERT_MESSAGE =
  'Your message contains inappropriate language and cannot be sent. Please revise your message and try again.';
