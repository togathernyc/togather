import { Redirect } from "expo-router";

/**
 * Default route for the (user) group.
 *
 * This file exists to prevent Expo Router from defaulting to an arbitrary
 * route when pre-rendering the (user) Stack on Android. Without this,
 * Android would default to the first route alphabetically (create-event.tsx).
 *
 * The _layout.tsx sets initialRouteName="redirect" to use this as the default.
 * This redirects to the root, which handles routing based on auth state.
 */
export default function UserRedirect() {
  return <Redirect href="/" />;
}
