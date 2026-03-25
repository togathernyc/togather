import {
  View,
  Text,
  Pressable,
  ScrollView,
  Linking,
  StyleSheet,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

const APP_STORE_URL = "https://apps.apple.com/app/togather/id6738726638";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=app.gatherful.mobile";

export function SuccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const handleDownload = (url: string) => {
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url);
    }
  };

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: colors.backgroundSecondary }]}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 },
      ]}
    >
      {/* Brand */}
      <Text style={[styles.brandText, { color: colors.text }]}>togather</Text>

      {/* Success Card */}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {/* Checkmark */}
        <View style={styles.checkmarkContainer}>
          <Ionicons name="checkmark-circle" size={72} color={colors.success} />
        </View>

        <Text style={[styles.heading, { color: colors.text }]}>
          Welcome to Togather!
        </Text>
        <Text style={[styles.subheading, { color: colors.textSecondary }]}>
          Your community is now active. You're the Primary Admin.
        </Text>

        {/* Admin Info Card */}
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: isDark
                ? "rgba(83, 189, 235, 0.1)"
                : "#EFF6FF",
              borderColor: isDark
                ? "rgba(83, 189, 235, 0.25)"
                : "#BFDBFE",
            },
          ]}
        >
          <Text
            style={[
              styles.infoCardTitle,
              { color: isDark ? colors.link : "#1E40AF" },
            ]}
          >
            What you can do as Primary Admin
          </Text>
          <View style={styles.bulletList}>
            <BulletItem
              text="Promote and demote other admins"
              color={isDark ? colors.link : "#1E40AF"}
            />
            <BulletItem
              text="Manage community settings and billing"
              color={isDark ? colors.link : "#1E40AF"}
            />
            <BulletItem
              text="Transfer ownership if needed"
              color={isDark ? colors.link : "#1E40AF"}
            />
          </View>
        </View>

        {/* Next Steps Card */}
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: isDark
                ? "rgba(255, 149, 0, 0.1)"
                : "#FFFBEB",
              borderColor: isDark
                ? "rgba(255, 149, 0, 0.25)"
                : "#FDE68A",
            },
          ]}
        >
          <Text
            style={[
              styles.infoCardTitle,
              { color: isDark ? colors.warning : "#92400E" },
            ]}
          >
            Next Steps
          </Text>
          <Text
            style={[
              styles.infoCardBody,
              { color: isDark ? colors.textSecondary : "#78350F" },
            ]}
          >
            Community configuration (group types, landing page, etc.) happens in
            the app's Admin tab. Download the app to get started.
          </Text>
        </View>

        {/* Download Buttons */}
        <View style={styles.downloadButtons}>
          <Pressable
            style={[
              styles.downloadButton,
              { backgroundColor: colors.buttonPrimary },
            ]}
            onPress={() => handleDownload(APP_STORE_URL)}
          >
            <Ionicons
              name="logo-apple"
              size={20}
              color={colors.buttonPrimaryText}
              style={styles.downloadIcon}
            />
            <Text
              style={[styles.downloadButtonText, { color: colors.buttonPrimaryText }]}
            >
              Download for iPhone
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.downloadButton,
              {
                backgroundColor: colors.buttonSecondary,
                borderWidth: 1,
                borderColor: colors.border,
              },
            ]}
            onPress={() => handleDownload(PLAY_STORE_URL)}
          >
            <Ionicons
              name="logo-google-playstore"
              size={20}
              color={colors.buttonSecondaryText}
              style={styles.downloadIcon}
            />
            <Text
              style={[
                styles.downloadButtonText,
                { color: colors.buttonSecondaryText },
              ]}
            >
              Download for Android
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Back to home link */}
      <Pressable
        style={styles.backLink}
        onPress={() => router.push("/")}
      >
        <Ionicons name="arrow-back" size={18} color={colors.link} />
        <Text style={[styles.backLinkText, { color: colors.link }]}>
          Back to home
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function BulletItem({ text, color }: { text: string; color: string }) {
  return (
    <View style={styles.bulletItem}>
      <Ionicons
        name="checkmark-circle-outline"
        size={18}
        color={color}
        style={styles.bulletIcon}
      />
      <Text style={[styles.bulletText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    alignItems: "center",
  },
  brandText: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: 24,
    alignSelf: "flex-start",
    maxWidth: 600,
    width: "100%",
  },
  card: {
    width: "100%",
    maxWidth: 600,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    ...Platform.select({
      web: {
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
      },
    }),
  },
  checkmarkContainer: {
    marginBottom: 16,
  },
  heading: {
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  subheading: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 24,
  },
  infoCard: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  infoCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 10,
  },
  infoCardBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  bulletList: {
    gap: 6,
  },
  bulletItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  bulletIcon: {
    marginRight: 8,
  },
  bulletText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  downloadButtons: {
    width: "100%",
    gap: 12,
    marginTop: 8,
  },
  downloadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 14,
    minHeight: 48,
  },
  downloadIcon: {
    marginRight: 8,
  },
  downloadButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    paddingVertical: 8,
  },
  backLinkText: {
    fontSize: 15,
    fontWeight: "500",
    marginLeft: 6,
  },
});
