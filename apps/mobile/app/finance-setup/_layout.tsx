import { Stack } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";

/**
 * Layout for the community finance onboarding flow (ADR-032 §2).
 *
 * Lives at the ROOT stack (not inside the `(user)` group) on purpose: the
 * whole `(user)` group is presented as a swipe-to-dismiss modal, which made
 * this multi-step form dismissible by an accidental drag and clipped it to a
 * sheet. Root-level card presentation (see `finance-setup` in app/_layout.tsx)
 * gives it a full screen with a normal back gesture — same pattern as
 * /rostering and /serving.
 *
 * Routes:
 * - /finance-setup         — onboarding status checklist
 * - /finance-setup/intake  — church details intake form
 */
export default function FinanceSetupLayout() {
  return (
    <UserRoute>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </UserRoute>
  );
}
