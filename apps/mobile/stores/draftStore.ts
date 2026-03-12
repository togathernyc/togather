/**
 * Draft Store
 *
 * Zustand store for persisting message drafts per channel.
 * Drafts survive channel switching and are cleared on send.
 */
import { create } from 'zustand';

interface DraftState {
  drafts: Record<string, string>;
  getDraft: (channelId: string) => string;
  setDraft: (channelId: string, text: string) => void;
  clearDraft: (channelId: string) => void;
}

export const useDraftStore = create<DraftState>()((set, get) => ({
  drafts: {},

  getDraft: (channelId: string) => {
    return get().drafts[channelId] || '';
  },

  setDraft: (channelId: string, text: string) => {
    set((state) => {
      const drafts = { ...state.drafts };
      if (text) {
        drafts[channelId] = text;
      } else {
        delete drafts[channelId];
      }
      return { drafts };
    });
  },

  clearDraft: (channelId: string) => {
    set((state) => {
      const drafts = { ...state.drafts };
      delete drafts[channelId];
      return { drafts };
    });
  },
}));
