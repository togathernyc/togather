/**
 * AuthErrorBoundary — recovers from a COMMUNITY_ARCHIVED query error instead
 * of crashing to the app-root ErrorBoundary.
 *
 * Background: `convex/react`'s `useQuery` re-throws query errors during
 * render (that's how the library surfaces them — there's no error return
 * value to check, so a try/catch around a hook call can't intercept this).
 * Some queries are mounted unconditionally as soon as an auth token exists —
 * e.g. NotificationProvider's `unreadCount` — so if the token is scoped to a
 * community that gets archived (closed) via admin Settings while the token is
 * still live (access tokens last 30 days), the strict `requireAuth` gate
 * throws `ConvexError("COMMUNITY_ARCHIVED")` on the very next render and the
 * app hard-crashes to the generic "Something went wrong" screen with no way
 * out, because the app-root ErrorBoundary sits ABOVE AuthProvider and has no
 * way to recover the session.
 *
 * This boundary sits INSIDE the provider tree, below AuthProvider, so it can
 * call `exitToCommunitySelection()` (re-mints a community-less token, wipes
 * per-community caches) and route the user back to community selection
 * instead of dead-ending. Any other error is re-thrown from
 * `getDerivedStateFromError` so it keeps propagating to the app-root
 * ErrorBoundary unchanged — this boundary only ever handles the one error
 * shape it knows how to recover from.
 *
 * The Convex-side comments referencing a mobile `AuthErrorBoundary` (see
 * apps/convex/lib/auth.ts, apps/convex/functions/scheduling/permissions.ts)
 * anticipated this component; today it's scoped to COMMUNITY_ARCHIVED only.
 *
 * IMPORTANT — never render `null` and never navigate imperatively while our
 * fallback is on screen. `ThemedStack` (the app's only Navigator) lives in
 * `this.props.children`, BELOW this boundary. Neither `AuthGuard`
 * (components/guards/AuthGuard.tsx — only redirects an *authenticated* user
 * away from public/auth-flow screens) nor `useInitialRouting`
 * (features/auth/hooks/useInitialRouting.ts — only mounted on the `/` index
 * route) will pick up a community-less session from an arbitrary in-app
 * screen, so this boundary must drive the redirect itself. It does so only
 * from `componentDidUpdate`, AFTER children (and therefore the navigator)
 * have remounted and committed — never synchronously from inside
 * `recover()`, which would fire while the fallback (or `null`) is still what
 * was last committed and the navigator may not exist yet.
 */
import React from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from './AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { isCommunityArchivedError } from '@services/api/convex';
import type { ThemeColors } from '@/theme/colors';

/**
 * Total recovery attempts allowed for a single archived-community incident
 * (the first automatic attempt on catch, plus one manual "Try again"). Once
 * exhausted without success, we stop retrying — see `recover()` — instead of
 * looping silently (the old behavior: a poisoned token on a transient
 * network failure would flicker/retry forever until connectivity returned).
 */
const MAX_RECOVERY_ATTEMPTS = 2;

interface Props {
  children: React.ReactNode;
  /** Injected by the AuthErrorBoundary wrapper so the class body can stay hook-free. */
  onCommunityArchived: () => Promise<boolean>;
  colors: ThemeColors;
}

type Phase = 'children' | 'recovering' | 'retry';

interface State {
  phase: Phase;
  /**
   * Set once `onCommunityArchived()` has actually succeeded AND we've
   * flipped back to `phase: 'children'`. Consumed by `componentDidUpdate`
   * to fire the deferred navigation exactly once, only after that render
   * has committed (i.e. the navigator is back in the tree).
   */
  pendingNavigation: boolean;
  /** Most recent COMMUNITY_ARCHIVED error caught — rethrown if recovery gives up. */
  originalError: unknown;
  /**
   * True once recovery has exhausted MAX_RECOVERY_ATTEMPTS without success.
   * `render()` rethrows `originalError` in this state — React error
   * boundaries never catch a throw from their own render, so this propagates
   * to the nearest ANCESTOR boundary (the app-root ErrorBoundary), handing
   * off to its generic crash screen instead of looping forever on a session
   * we've already tried (and failed) to recover twice.
   */
  giveUp: boolean;
}

class AuthErrorBoundaryClass extends React.Component<Props, State> {
  /**
   * Attempt counter for the CURRENT incident. Kept as an instance field
   * (not state) so it's read synchronously inside `recover()` without
   * fighting React's setState batching, and reset to 0 on a successful
   * recovery so a later, unrelated archival incident gets its own fresh
   * budget rather than inheriting an exhausted one from earlier in the app
   * session (this boundary is mounted once, for the app's lifetime).
   */
  private attempts = 0;

  constructor(props: Props) {
    super(props);
    this.state = {
      phase: 'children',
      pendingNavigation: false,
      originalError: null,
      giveUp: false,
    };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    if (!isCommunityArchivedError(error)) {
      // Not ours to handle — rethrow so the error keeps bubbling to the
      // nearest ancestor boundary (the app-root ErrorBoundary).
      throw error;
    }
    return { phase: 'recovering', originalError: error };
  }

  componentDidCatch(error: unknown) {
    console.warn(
      '[AuthErrorBoundary] Recovering from archived-community session:',
      error,
    );
    this.recover();
  }

  componentDidUpdate() {
    // Only fire once children (and the navigator underneath them) have
    // actually remounted and committed — see the file-level comment for why
    // this can never safely happen synchronously from inside recover().
    if (this.state.pendingNavigation && this.state.phase === 'children') {
      this.navigateToSelectCommunity();
    }
  }

  private navigateToSelectCommunity = () => {
    // Consume the flag first so this can't re-fire from the setState below.
    this.setState({ pendingNavigation: false });
    try {
      router.replace('/(auth)/select-community');
    } catch (navError) {
      // Defensive: by this point the navigator should already be mounted
      // (componentDidUpdate fires after children have committed), but
      // navigation across React Navigation / expo-router has enough moving
      // parts that a single retry-on-next-tick is cheap insurance against a
      // permanent blank screen if it isn't quite ready yet.
      console.error(
        '[AuthErrorBoundary] Navigation failed, retrying next tick:',
        navError,
      );
      setTimeout(() => {
        try {
          router.replace('/(auth)/select-community');
        } catch (retryError) {
          console.error(
            '[AuthErrorBoundary] Navigation retry failed:',
            retryError,
          );
        }
      }, 0);
    }
  };

  private recover = async () => {
    if (this.attempts >= MAX_RECOVERY_ATTEMPTS) {
      this.setState({ giveUp: true });
      return;
    }
    this.attempts += 1;
    this.setState({ phase: 'recovering' });

    let success = false;
    try {
      // exitToCommunitySelection() resolves `false` (rather than throwing)
      // on a failed token re-mint — e.g. a transient network error — so we
      // can tell a genuinely failed recovery apart from success instead of
      // assuming success just because the call didn't throw and leaving the
      // poisoned, still-archived-scoped token active.
      success = await this.props.onCommunityArchived();
    } catch (recoveryError) {
      console.error('[AuthErrorBoundary] Recovery threw:', recoveryError);
      success = false;
    }

    if (success) {
      this.attempts = 0;
      // Flip back to rendering children FIRST. Only once THIS commits is
      // the navigator (e.g. ThemedStack) actually back in the tree — the
      // navigation itself happens from componentDidUpdate once that's true.
      this.setState({ phase: 'children', pendingNavigation: true });
      return;
    }

    if (this.attempts >= MAX_RECOVERY_ATTEMPTS) {
      this.setState({ giveUp: true });
    } else {
      this.setState({ phase: 'retry' });
    }
  };

  render() {
    if (this.state.giveUp) {
      throw this.state.originalError;
    }

    if (this.state.phase === 'recovering') {
      return <SwitchingCommunityView colors={this.props.colors} />;
    }

    if (this.state.phase === 'retry') {
      return (
        <RecoveryRetryView colors={this.props.colors} onRetry={this.recover} />
      );
    }

    return this.props.children;
  }
}

/**
 * Fallback shown while `recover()` is in flight. Deliberately never `null` —
 * returning `null` here would unmount `this.props.children`, which is where
 * the app's only Navigator (`ThemedStack`) lives (see the file-level
 * comment). Palette mirrors components/ErrorBoundary.tsx's fallback
 * (centered card look) but sourced from theme tokens since, unlike the
 * app-root ErrorBoundary, this boundary sits below ThemeProvider.
 */
function SwitchingCommunityView({ colors }: { colors: ThemeColors }) {
  const styles = createStyles(colors);
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.buttonPrimary} />
      <Text style={styles.message}>Switching community…</Text>
    </View>
  );
}

function RecoveryRetryView({
  colors,
  onRetry,
}: {
  colors: ThemeColors;
  onRetry: () => void;
}) {
  const styles = createStyles(colors);
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Couldn't switch communities</Text>
        <Text style={styles.message}>
          That community is no longer available and we couldn't finish moving
          you back to community selection. Check your connection and try
          again.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onRetry}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      padding: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingVertical: 32,
      paddingHorizontal: 24,
      alignItems: 'center',
      maxWidth: 400,
      width: '100%',
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: colors.text,
      marginBottom: 12,
      textAlign: 'center',
    },
    message: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginTop: 12,
      marginBottom: 8,
    },
    primaryButton: {
      backgroundColor: colors.buttonPrimary,
      paddingHorizontal: 24,
      paddingVertical: 14,
      borderRadius: 10,
      width: '100%',
      alignItems: 'center',
      marginTop: 16,
    },
    primaryButtonText: {
      color: colors.buttonPrimaryText,
      fontSize: 16,
      fontWeight: '600',
    },
  });
}

export function AuthErrorBoundary({ children }: { children: React.ReactNode }) {
  const { exitToCommunitySelection } = useAuth();
  const { colors } = useTheme();

  return (
    <AuthErrorBoundaryClass onCommunityArchived={exitToCommunitySelection} colors={colors}>
      {children}
    </AuthErrorBoundaryClass>
  );
}
