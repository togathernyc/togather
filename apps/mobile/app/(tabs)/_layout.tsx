import { View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';
import { useIsDesktopWeb } from '../../hooks/useIsDesktopWeb';
import { useWhatsappShell } from '../../hooks/useWhatsappShell';
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

  // Serving mode collapses the tab bar to a focused set — ordered
  // Runsheet · Inbox · Tasks · Exit (no Profile) — for the duration of an event.
  // Gated on the community opting into the Event Tasks feature so communities
  // without it never see serving tabs even if a stale persisted flag lingers.
  const eventTasksEnabled =
    (community?.churchFeatures as { eventTasksEnabled?: boolean } | undefined)
      ?.eventTasksEnabled === true;
  const isServingMode = useEventModeStore((s) => s.isServingMode);
  const exitServingMode = useEventModeStore((s) => s.exit);
  const inServingMode = isServingMode && eventTasksEnabled;
  const router = useRouter();

  // `whatsapp-shell`-gated 4-tab shell (Chats · Events · Prayer · You). Never
  // active during serving mode — see docs/plans/church-migration-ui-redesign
  // /README.md §5, §9.5. Flag off (or still loading) = today's 6-tab layout,
  // byte-for-byte.
  const whatsappShellFlag = useWhatsappShell();
  const showWhatsappShell = whatsappShellFlag && !inServingMode;

  // Chat/Inbox is shared between the serving tab bar (as "Inbox", second
  // slot) and the normal tab bar (as "Inbox", or "Chats" + first slot under
  // the whatsapp shell) — defined once and placed at whichever JSX position
  // produces the right visible order for the active mode.
  const chatTabScreen = (
    <Tabs.Screen
      name="chat"
      options={{
        title: showWhatsappShell ? 'Chats' : 'Inbox',
        // Only show Inbox/Chats tab when user has a community context
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
  );

  const tabs = (
    <Tabs
      // Expo Router's Tabs computes its visible tab set from `href` at mount and
      // doesn't reliably re-render the bar when hrefs flip at runtime — so
      // entering/leaving serving mode (or flipping the whatsapp-shell flag)
      // left the OLD tabs on screen until a refresh. Keying the navigator on
      // the mode remounts it on that (rare) transition, recomputing the tab
      // set. Stable within each mode, so normal navigation is unaffected.
      key={inServingMode ? 'serving' : showWhatsappShell ? 'whatsapp' : 'normal'}
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

      {/* whatsapp-shell: Chats leads the tab bar (docs/plans/church-migration
          -ui-redesign/README.md §5). Off (or serving mode): this renders
          nothing and Inbox keeps its normal position below. */}
      {showWhatsappShell && chatTabScreen}

      {/* Visible tabs - Order: Groups, Events, Inbox, (Admin for admins), Profile */}
      {/* Groups/Events are hidden while serving mode is active. Groups (Search)
          is also hidden under the whatsapp-shell — its route stays reachable,
          just not tab-visible. */}
      <Tabs.Screen
        name="search"
        options={{
          title: 'Groups',
          href: inServingMode || showWhatsappShell ? null : '/(tabs)/search',
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
      {/* Serving-mode Runsheet sits immediately before Inbox so the serving
          tab order reads Runsheet · Inbox · Tasks · Exit. Normal mode hides the
          serving tabs (href: null), so its order is unaffected. */}
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
      {/* Normal-mode (non-whatsapp-shell) Inbox sits here, after Groups/Events,
          matching today's tab order. Under the whatsapp shell it's rendered
          first instead (above) — see `chatTabScreen`. */}
      {!showWhatsappShell && chatTabScreen}
      {/* Serving-mode Tasks + Exit sit immediately after Inbox. */}
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
        listeners={{
          // Exit is an action, not a destination: intercept the tap so we never
          // focus the (about-to-be-hidden) serving-exit route. Navigate to Inbox
          // (visible in both modes) first, then drop serving mode so the tab bar
          // re-renders to the normal layout. Doing it here avoids the focus/blur
          // race a screen-side effect hit (its cleanup cancelled the exit).
          tabPress: (e) => {
            if (!inServingMode) return;
            e.preventDefault();
            router.replace('/(tabs)/chat');
            requestAnimationFrame(() => exitServingMode());
          },
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
          // internal users. Hidden while serving mode is active, and hidden
          // under the whatsapp-shell (admin moves into You + the community
          // page there — its route stays reachable).
          href:
            !inServingMode &&
            !showWhatsappShell &&
            ((isAdmin && hasCommunity) || isInternalUser)
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
      <Tabs.Screen
        name="profile"
        options={{
          // "You" under the whatsapp-shell (docs/plans/church-migration-ui
          // -redesign/README.md §5); "Profile" otherwise.
          title: showWhatsappShell ? 'You' : 'Profile',
          // Hidden while serving mode is active to keep the serving tab bar to
          // Runsheet · Inbox · Tasks · Exit.
          href: inServingMode ? null : '/(tabs)/profile',
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
