import { Platform, Linking } from 'react-native';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';

export type ExternalChatPlatform = 'whatsapp' | 'slack' | 'telegram' | 'discord' | 'unknown';

export interface ExternalChatInfo {
  platform: ExternalChatPlatform;
  name: string;
  /** Ionicons icon name */
  iconName: string;
  /** Brand color for the platform */
  color: string;
  /** Description shown in the modal */
  description: string;
  /** App Store URL (iOS) */
  appStoreUrl: string;
  /** Play Store URL (Android) */
  playStoreUrl: string;
}

const PLATFORM_INFO: Record<ExternalChatPlatform, Omit<ExternalChatInfo, 'platform'>> = {
  whatsapp: {
    name: 'WhatsApp',
    iconName: 'logo-whatsapp',
    color: '#25D366',
    description: 'This group also messages on WhatsApp. Download the app to join the conversation there.',
    appStoreUrl: 'https://apps.apple.com/app/whatsapp-messenger/id310633997',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.whatsapp',
  },
  slack: {
    name: 'Slack',
    iconName: 'logo-slack',
    color: '#4A154B',
    description: 'This group also messages on Slack. Download the app to join the conversation there.',
    appStoreUrl: 'https://apps.apple.com/app/slack/id618783545',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.Slack',
  },
  telegram: {
    name: 'Telegram',
    iconName: 'paper-plane',
    color: '#0088CC',
    description: 'This group also messages on Telegram. Download the app to join the conversation there.',
    appStoreUrl: 'https://apps.apple.com/app/telegram-messenger/id686449807',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=org.telegram.messenger',
  },
  discord: {
    name: 'Discord',
    iconName: 'logo-discord',
    color: '#5865F2',
    description: 'This group also messages on Discord. Download the app to join the conversation there.',
    appStoreUrl: 'https://apps.apple.com/app/discord-talk-chat-hang-out/id985746746',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.discord',
  },
  unknown: {
    name: 'External Chat',
    iconName: 'chatbubbles',
    color: DEFAULT_PRIMARY_COLOR,
    description: 'This group also messages on an external platform. Click the link to join the conversation there.',
    appStoreUrl: '',
    playStoreUrl: '',
  },
};

/**
 * Detects the chat platform from a URL
 */
export function detectPlatformFromUrl(url: string): ExternalChatPlatform {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('whatsapp.com') || lowerUrl.includes('wa.me')) {
    return 'whatsapp';
  }
  if (lowerUrl.includes('slack.com')) {
    return 'slack';
  }
  if (lowerUrl.includes('t.me') || lowerUrl.includes('telegram.me') || lowerUrl.includes('telegram.org')) {
    return 'telegram';
  }
  if (lowerUrl.includes('discord.gg') || lowerUrl.includes('discord.com') || lowerUrl.includes('discordapp.com')) {
    return 'discord';
  }

  return 'unknown';
}

/**
 * Gets full platform info for a URL
 */
export function getExternalChatInfo(url: string): ExternalChatInfo {
  const platform = detectPlatformFromUrl(url);
  return {
    platform,
    ...PLATFORM_INFO[platform],
  };
}

/**
 * Opens the external chat link
 */
export async function openExternalChatLink(url: string): Promise<void> {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      // If can't open directly, try opening in browser
      await Linking.openURL(url);
    }
  } catch (error) {
    console.error('Failed to open external chat link:', error);
    throw error;
  }
}

/**
 * Opens the app store page for the platform
 */
export async function openAppStore(platform: ExternalChatPlatform): Promise<void> {
  const info = PLATFORM_INFO[platform];
  const storeUrl = Platform.OS === 'ios' ? info.appStoreUrl : info.playStoreUrl;

  if (storeUrl) {
    try {
      await Linking.openURL(storeUrl);
    } catch (error) {
      console.error('Failed to open app store:', error);
      throw error;
    }
  }
}
