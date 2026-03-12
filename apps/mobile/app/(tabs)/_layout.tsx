import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useIsDesktopWeb } from '../../hooks/useIsDesktopWeb';
import { DesktopSideNav } from '@components/DesktopSideNav';

export default function TabsLayout() {
  const { user, community } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const isDesktopWeb = useIsDesktopWeb();
  const isAdmin = user?.is_admin === true;

  // Use stable state for tab visibility to prevent infinite loops
  // Only update when community actually changes (not on every render)
  const [hasCommunity, setHasCommunity] = useState(!!community?.id);
  const prevCommunityIdRef = useRef(community?.id);

  // Update hasCommunity state only when community.id actually changes
  // This prevents infinite loops from Expo Router tab reconfiguration
  useEffect(() => {
    const currentCommunityId = community?.id;
    if (prevCommunityIdRef.current !== currentCommunityId) {
      prevCommunityIdRef.current = currentCommunityId;
      setHasCommunity(!!currentCommunityId);
    }
  }, [community?.id]);

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: primaryColor,
        tabBarInactiveTintColor: '#999',
        tabBarStyle: isDesktopWeb
          ? { display: 'none' as const }
          : {
              backgroundColor: '#fff',
              borderTopWidth: 1,
              borderTopColor: '#e0e0e0',
              paddingBottom: 8,
              paddingTop: 8,
              height: 64,
            },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        animation: 'none',
      }}
    >
      {/* Hidden tabs - keep files but hide from nav */}
      <Tabs.Screen
        name="groups"
        options={{
          href: null,
        }}
      />

      {/* Visible tabs - Order: Explore, Inbox, (Admin for admins), Profile */}
      <Tabs.Screen
        name="search"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'globe' : 'globe-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          // Keep the route available, but hide from primary tab navigation.
          // Tasks are accessed via Profile.
          href: null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'checkmark-done' : 'checkmark-done-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Inbox',
          // Only show Inbox tab when user has a community context
          href: hasCommunity ? '/(tabs)/chat' : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          // Only show Admin tab to community admins with active community context
          href: isAdmin && hasCommunity ? '/(tabs)/admin' : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );

  if (isDesktopWeb) {
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <DesktopSideNav />
        {tabs}
      </View>
    );
  }

  return tabs;
}
