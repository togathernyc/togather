import type { DesignGroup } from '../../utils/inboxDesignAdapter';

export interface InboxDesignProps {
  items: DesignGroup[];
  loading: boolean;
  sidebarMode?: boolean;
  activeGroupId?: string;
  activeChannelSlug?: string;
  onGroupPress: (groupId: string) => void;
  onChannelPress: (groupId: string, channelSlug: string) => void;
}
