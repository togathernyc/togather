import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ImageBackground,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SafeLinearGradient } from "@/components/ui/SafeLinearGradient";
import { AuthGuard } from "@/components/guards/AuthGuard";

export default function LandingPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleGetStarted = () => {
    router.push("/(auth)/signin");
  };

  return (
    <AuthGuard>
      <View style={styles.container}>
        <ImageBackground
          source={require("@/assets/images/splash-hero.png")}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          {/* Gradient overlay for better text readability - only at top */}
          <SafeLinearGradient
            colors={["rgba(0,0,0,0.3)", "transparent", "transparent"]}
            locations={[0, 0.4, 1]}
            style={styles.gradient}
          >
            {/* Top content - Logo */}
            <View style={[styles.topContent, { paddingTop: insets.top + 60 }]}>
              <Text style={styles.logo}>Togather</Text>
              <Text style={styles.tagline}>Your community, in your pocket</Text>
            </View>

            {/* Bottom content - CTA */}
            <View style={styles.bottomContent}>
              <TouchableOpacity
                style={styles.getStartedButton}
                onPress={handleGetStarted}
                activeOpacity={0.9}
              >
                <Text style={styles.getStartedText}>Get Started</Text>
              </TouchableOpacity>
            </View>
          </SafeLinearGradient>
        </ImageBackground>
      </View>
    </AuthGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
    width: "100%",
  },
  gradient: {
    flex: 1,
    justifyContent: "space-between",
  },
  topContent: {
    alignItems: "center",
    paddingHorizontal: 24,
  },
  logo: {
    fontSize: 48,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: -1,
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  tagline: {
    fontSize: 18,
    color: "rgba(255, 255, 255, 0.9)",
    marginTop: 8,
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  bottomContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  getStartedButton: {
    backgroundColor: "#fff",
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  getStartedText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
  },
});
