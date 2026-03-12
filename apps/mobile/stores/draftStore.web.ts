/**
 * Draft Store (Web)
 *
 * Web-compatible in-memory draft store without zustand dependency.
 * Drafts survive channel switching and are cleared on send.
 */

const drafts: Record<string, string> = {};

const state = {
  drafts,
  getDraft: (channelId: string): string => {
    return drafts[channelId] || '';
  },
  setDraft: (channelId: string, text: string): void => {
    if (text) {
      drafts[channelId] = text;
    } else {
      delete drafts[channelId];
    }
  },
  clearDraft: (channelId: string): void => {
    delete drafts[channelId];
  },
};

const noopStore = {
  getState: () => state,
};

export const useDraftStore = Object.assign(
  () => state,
  noopStore,
);
