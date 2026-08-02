/**
 * give-success — the thank-you a donor lands on after Stripe Checkout.
 *
 * Reached two ways, and the constraint comes from the harder one:
 *
 *  - **Web/mobile web:** a plain browser redirect to Stripe's `success_url`
 *    (built by `buildGiveReturnUrls` in apps/convex/functions/finance/giving.ts).
 *    The app is cold-booting and auth is still restoring.
 *  - **Native:** `GiveScreen`'s waiting step routes here itself once
 *    `getCheckoutSessionStatus` reports the donation landed.
 *
 * So this screen runs ZERO authenticated queries. Everything it shows comes
 * off the URL — amount in integer cents, fund name, community name, all
 * already percent-encoded by the backend and decoded by expo-router — and
 * garbage params degrade instead of breaking (see `parseGiveSuccessParams`).
 *
 * The two return paths differ, and conflating them strands the donor: in that
 * in-app browser there is nothing to return TO (`/fund`'s queries would all
 * skip and leave a permanent skeleton), so the thank-you is terminal there and
 * offers "you can close this window" instead of navigating. `useStoredAuthToken`
 * tells the two apart — it reads storage, not Convex, so it costs no query.
 *
 * No `expo-linear-gradient` for the gold wash, deliberately: that module is
 * disabled on Fabric in this app (see components/ui/SafeLinearGradient.tsx and
 * ADR-013), and a tinted View is the same picture with no native view in it.
 */
import React, { useEffect } from "react";
import { View, Text, StyleSheet, Image, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStoredAuthToken } from "@services/api/convex";
import { parseGiveSuccessParams } from "@features/finance/member/giveSuccessParams";
import { GIVING_GOLD_WASH } from "@features/finance/member/giveTheme";

const starStrikeGif = require("../../../assets/star-strike.gif");

/** How long the thank-you holds before it hands the donor back to the fund. */
const AUTO_RETURN_MS = 4000;

export default function GiveSuccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    group_id: string;
    amount?: string;
    fund?: string;
    community?: string;
  }>();

  const { amountLabel, thankYouLine, fundLine } = parseGiveSuccessParams(params);
  const groupId = params.group_id;
  const token = useStoredAuthToken();

  const goToFund = React.useCallback(() => {
    // The native flow arrived as fund → give → (replaced) give-success, so the
    // fund is still one frame down: pop back to it rather than pushing a second
    // copy, which would leave Back revealing an identical fund screen. A cold
    // web boot on Stripe's success_url has no stack, and gets a replace.
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/groups/${groupId}/fund` as any);
  }, [router, groupId]);

  useEffect(() => {
    // No token means this is Stripe's in-app browser, which has its own
    // storage and no session — `/fund` there is a skeleton that never fills,
    // so the thank-you stays put and the donor closes the sheet themselves.
    if (!token) return;
    const timer = setTimeout(goToFund, AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  }, [goToFund, token]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
      {/* The wash is a soft gold band behind the top of the card, not a
          full-bleed background — the page itself stays white so the amount
          reads as the only thing on it. */}
      <View style={styles.wash} pointerEvents="none" />

      <View style={styles.content}>
        <Image source={starStrikeGif} style={styles.gif} />
        <Text style={styles.thankYou}>{thankYouLine}</Text>
        {!!amountLabel && (
          <Text style={styles.amount} testID="give-success-amount">
            {amountLabel}
          </Text>
        )}
        {!!fundLine && <Text style={styles.fund}>{fundLine}</Text>}
      </View>

      {token ? (
        <Pressable
          onPress={goToFund}
          accessibilityRole="button"
          accessibilityLabel="Done"
          style={({ pressed }) => [styles.donePill, pressed && styles.pressed]}
        >
          <Text style={styles.doneLabel}>Done</Text>
        </Pressable>
      ) : (
        <Text style={styles.closeHint} testID="give-success-close-hint">
          You can close this window.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Fixed light palette rather than the themed one on purpose: this renders
  // before providers have settled, and a celebration card that flips to a dark
  // surface mid-animation reads as a glitch.
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  wash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "45%",
    backgroundColor: GIVING_GOLD_WASH,
    borderBottomLeftRadius: 400,
    borderBottomRightRadius: 400,
    transform: [{ scaleX: 1.6 }],
  },
  content: { alignItems: "center", flex: 1, justifyContent: "center" },
  gif: { width: 140, height: 140, marginBottom: 16 },
  thankYou: {
    fontSize: 20,
    fontWeight: "600",
    color: "#4A4A4A",
    textAlign: "center",
  },
  amount: {
    fontSize: 44,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    color: "#111111",
    marginTop: 8,
  },
  fund: {
    fontSize: 15,
    color: "#6B6B6B",
    textAlign: "center",
    marginTop: 6,
  },
  donePill: {
    alignSelf: "stretch",
    height: 50,
    borderRadius: 25,
    backgroundColor: "#222224",
    alignItems: "center",
    justifyContent: "center",
  },
  doneLabel: { fontSize: 17, fontWeight: "600", color: "#FFFFFF" },
  closeHint: {
    fontSize: 15,
    color: "#6B6B6B",
    textAlign: "center",
    paddingVertical: 15,
  },
  pressed: { opacity: 0.85 },
});
