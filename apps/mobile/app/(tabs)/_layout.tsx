import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';
import { useIsDesktopWeb } from '../../hooks/useIsDesktopWeb';
import { DesktopSideNav } from '@components/DesktopSideNav';
import { useEventModeStore } from '@/stores/eventModeStore';

export default function TabsLayout() {
  const { user, community } = useAuth();
  const { primaryColor, isKnicksMode } = useCommunityTheme();
  const { colors } = useTheme();
  const isDesktopWeb = useIsDesktopWeb();
  const isAdmin = user?.is_admin === true;
  const isInternalUser = user?.is_staff === true || user?.is_superuser === true;

  // community?.id is a primitive string — direct derivation is stable and
  // won't cause tab config oscillation. The old useState+useEffect pattern
  // was over-engineered and introduced a stale render frame.
  const hasCommunity = !!community?.id;

  // Serving mode collapses the tab bar to a focused set (Inbox, Runsheet,
  // Tasks, Profile, Exit) for the duration of an event. Gated on the community
  // opting into the Event Tasks feature so communities without it never see
  // serving tabs even if a stale persisted flag lingers.
  const eventTasksEnabled =
    (community?.churchFeatures as { eventTasksEnabled?: boolean } | undefined)
      ?.eventTasksEnabled === true;
  const isServingMode = useEventModeStore((s) => s.isServingMode);
  const inServingMode = isServingMode && eventTasksEnabled;

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: primaryColor,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarStyle: isDesktopWeb
          ? { display: 'none' as const }
          : {
              backgroundColor: colors.tabBar,
              borderTopWidth: 1,
              borderTopColor: colors.tabBarBorder,
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

      {/* Visible tabs - Order: Groups, Events, Inbox, (Admin for admins), Profile */}
      {/* Groups/Events are hidden while serving mode is active. */}
      <Tabs.Screen
        name="search"
        options={{
          title: 'Groups',
          href: inServingMode ? null : '/(tabs)/search',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'map' : 'map-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: 'Events',
          href: inServingMode ? null : '/(tabs)/events',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'calendar' : 'calendar-outline'}
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
        name="people"
        options={{
          title: 'People',
          // Hidden tab — accessed via Profile menu
          href: null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
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
              name={
                isKnicksMode
                  ? focused
                    ? 'basketball'
                    : 'basketball-outline'
                  : focused
                    ? 'chatbubbles'
                    : 'chatbubbles-outline'
              }
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="prayer"
        options={{
          title: 'Prayer',
          // Visible only when the active community has opted into the church
          // prayer feature. Gated on community.churchFeatures.prayerEnabled.
          // Hidden while serving mode is active.
          href:
            !inServingMode && hasCommunity && community?.churchFeatures?.prayerEnabled
              ? '/(tabs)/prayer'
              : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'heart' : 'heart-outline'}
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
          // Show Admin tab for community admins within a community OR Togather
          // internal users. Hidden while serving mode is active.
          href:
            !inServingMode && ((isAdmin && hasCommunity) || isInternalUser)
              ? '/(tabs)/admin'
              : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />

      {/* Serving-mode tabs — only visible while serving mode is active. */}
      <Tabs.Screen
        name="serving-runsheet"
        options={{
          title: 'Runsheet',
          href: inServingMode ? '/(tabs)/serving-runsheet' : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'list' : 'list-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="serving-tasks"
        options={{
          title: 'Tasks',
          href: inServingMode ? '/(tabs)/serving-tasks' : null,
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
        name="serving-exit"
        options={{
          title: 'Exit',
          href: inServingMode ? '/(tabs)/serving-exit' : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'exit' : 'exit-outline'}
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
