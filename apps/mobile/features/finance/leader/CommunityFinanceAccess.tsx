/**
 * The client half of ADR-033 §5's community-level finance gate.
 *
 * WHY A BOUNDARY AND NOT A `useQuery` CHECK. `canManageCommunityFinance` is
 * "primary admin OR an active `communityFinanceRoles` grant", and there is no
 * cheap non-throwing query that reports it for a community: every
 * community-level finance query (`getCardProviderStatus`,
 * `listCommunityFinanceRoles`, `listGrantableFinanceAdmins`) is itself gated
 * and raises a ConvexError for anyone else. Convex's `useQuery` re-throws that
 * during render, so without a boundary the exact population ADR-033 created —
 * a plain community admin with no grant — lands in the app's root
 * ErrorBoundary looking at "Something went wrong" for a permission answer.
 *
 * The screens still pre-gate on `user?.is_admin` so the common case never
 * touches this: a grant only counts while its holder is still a community
 * admin (`canManageCommunityFinance` re-checks that), so non-admins can be
 * refused client-side with certainty. This catches the remaining case —
 * admin, no grant — and only that one.
 *
 * NOT the shared `components/ErrorBoundary`: that reports to Sentry and shows
 * a crash screen. A permission denial is an expected answer, not an incident.
 * Anything that isn't recognisably an access denial is RE-THROWN, so a real
 * failure still reaches the app boundary instead of being disguised as
 * "you don't have access".
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import { EmptyState } from "@components/ui";
import { errorMessage } from "@/utils/error-handling";

/**
 * The phrase every community-finance refusal shares
 * (`requireCommunityFinanceAccess` and the two `communityRoles` queries).
 * Matching on it — rather than on any thrown error — is what keeps a network
 * failure from being reported to the user as a permissions problem.
 */
const ACCESS_DENIAL_MARKER = "financial-controls access";

export function isCommunityFinanceAccessDenial(error: unknown): boolean {
  return errorMessage(error, "").includes(ACCESS_DENIAL_MARKER);
}

export interface CommunityFinanceAccessDeniedProps {
  /** What the viewer was trying to do, e.g. "Connecting a card provider". */
  message: string;
}

/** The one place this refusal is worded, so both entry points agree. */
export function CommunityFinanceAccessDenied({
  message,
}: CommunityFinanceAccessDeniedProps) {
  return (
    <View style={styles.container} testID="community-finance-access-denied">
      <EmptyState
        icon="lock-closed-outline"
        title="You need financial-controls access"
        message={message}
      />
    </View>
  );
}

interface BoundaryProps {
  /** Rendered in place of `children` when a finance query refuses the viewer. */
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface BoundaryState {
  denied: boolean;
}

export class CommunityFinanceAccessBoundary extends React.Component<
  BoundaryProps,
  BoundaryState
> {
  state: BoundaryState = { denied: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    // Re-throw anything that isn't an access denial. `getDerivedStateFromError`
    // is allowed to throw: React treats it as an error in this boundary and
    // hands it to the next one up, which is exactly where a genuine failure
    // belongs.
    if (!isCommunityFinanceAccessDenial(error)) throw error;
    return { denied: true };
  }

  render() {
    return this.state.denied ? this.props.fallback : this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
