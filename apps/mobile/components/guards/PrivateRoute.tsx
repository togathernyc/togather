import { Redirect } from 'expo-router';
import { useAuth } from '@providers/AuthProvider';
import { View, ActivityIndicator } from 'react-native';

/**
 * PrivateRoute - For admin pages that require authentication and admin role
 * Equivalent to Next.js PrivateRoute HOC
 */
export function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  // Token exists but user data hasn't loaded (offline without cached profile).
  // Show a loading spinner instead of redirecting — the data will load when
  // connectivity returns.
  if (!user) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!user.is_admin) {
    return <Redirect href="/(tabs)/chat" />;
  }

  return <>{children}</>;
}

