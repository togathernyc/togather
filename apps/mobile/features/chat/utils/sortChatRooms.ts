import type { ChatRoom } from "../types";

/**
 * Sorts chat rooms by last message time (most recent first)
 */
export function sortChatRooms(rooms: ChatRoom[]): ChatRoom[] {
  if (!Array.isArray(rooms)) return [];
  
  return [...rooms].sort((a, b) => {
    const dateA = a.last_message_at
      ? new Date(a.last_message_at).getTime()
      : 0;
    const dateB = b.last_message_at
      ? new Date(b.last_message_at).getTime()
      : 0;
    return dateB - dateA;
  });
}

