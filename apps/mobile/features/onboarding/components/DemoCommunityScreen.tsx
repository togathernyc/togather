/**
 * DemoCommunityScreen - Self-serve demo community questionnaire.
 *
 * Route: /onboarding/demo
 *
 * A prospective church answers a few questions (name, size, campuses, small
 * groups, zip code, logo, brand colors) and instantly gets a private seeded
 * community where they are the admin: groups, channel conversations, events
 * with RSVPs, and prayer requests, all themed with their branding. Teammates
 * can join the same demo with the demo code and edit it simultaneously.
 *
 * Backend: functions/demo.ts (createDemoCommunity / joinDemoCommunity).
 */
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import {
  api,
  useAuthenticatedMutation,
  useAuthenticatedAction,
} from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useSelectCommunity } from "@features/auth/hooks/useAuth";
import { useTheme } from "@hooks/useTheme";
import { ImagePicker } from "@components/ui";
import { ColorInput, isValidHex } from "./ColorInput";

type DemoResult = {
  communityId: string;
  name: string;
  logo: string | null;
  demoCode: string;
};

export function DemoCommunityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isAuthenticated, isLoading: authLoading, setCommunity, refreshUser } = useAuth();

  const createDemo = useAuthenticatedMutation(api.functions.demo.createDemoCommunity);
  const joinDemo = useAuthenticatedMutation(api.functions.demo.joinDemoCommunity);
  const getR2UploadUrl = useAuthenticatedAction(api.functions.uploads.getR2UploadUrl);
  const selectCommunityMutation = useSelectCommunity();

  // ---- Questionnaire state ----
  const [name, setName] = useState("");
  const [totalSize, setTotalSize] = useState("");
  const [campusCount, setCampusCount] = useState("");
  const [smallGroupCount, setSmallGroupCount] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState("#1E8449");
  const [secondaryColor, setSecondaryColor] = useState("#2E86C1");

  // ---- Join-by-code state ----
  const [joinCode, setJoinCode] = useState("");

  // ---- Submission state ----
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoResult | null>(null);

  const formValid =
    name.trim().length > 0 &&
    isValidHex(primaryColor) &&
    isValidHex(secondaryColor);

  /** Upload the picked logo to R2 and return its storage path. */
  async function uploadLogo(imageUri: string): Promise<string> {
    const fileName = (imageUri.split("/").pop() || "logo.jpg").split("?")[0];
    const fileExtension = fileName.split(".").pop()?.toLowerCase() || "jpg";
    const contentType = `image/${fileExtension === "jpg" ? "jpeg" : fileExtension}`;

    const { uploadUrl, storagePath } = await getR2UploadUrl({
      fileName,
      contentType,
      folder: "uploads" as const, // community logos folder
    });

    if (Platform.OS === "web") {
      const response = await fetch(imageUri);
      const blob = await response.blob();
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": contentType },
      });
      if (!uploadResponse.ok) {
        throw new Error(`Logo upload failed: ${uploadResponse.status}`);
      }
    } else {
      const uploadResult = await uploadAsync(uploadUrl, imageUri, {
        httpMethod: "PUT",
        uploadType: FileSystemUploadType.BINARY_CONTENT,
        headers: { "Content-Type": contentType },
      });
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Logo upload failed: ${uploadResult.status}`);
      }
    }
    return storagePath;
  }

  function parseCount(value: string): number | undefined {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  async function handleCreate() {
    if (!formValid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const logo = logoUri ? await uploadLogo(logoUri) : undefined;
      const result = await createDemo({
        name: name.trim(),
        totalSize: parseCount(totalSize),
        campusCount: parseCount(campusCount),
        smallGroupCount: parseCount(smallGroupCount),
        zipCode: zipCode.trim() || undefined,
        logo,
        primaryColor,
        secondaryColor,
      });
      setDemo(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoin() {
    if (!joinCode.trim() || joining) return;
    setError(null);
    setJoining(true);
    try {
      const result = await joinDemo({ code: joinCode.trim() });
      await enterDemo(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setJoining(false);
    }
  }

  /** Re-scope the session to the demo community and land in the app. */
  async function enterDemo(target: DemoResult) {
    setEntering(true);
    try {
      await selectCommunityMutation.mutateAsync({ communityId: target.communityId });
      await setCommunity({
        id: target.communityId,
        name: target.name,
        logo: target.logo ?? undefined,
      });
      await refreshUser();
      router.replace("/(tabs)/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setEntering(false);
      setJoining(false);
    }
  }

  // ---- Auth gate: demos belong to a signed-in user so teammates can rejoin ----
  if (!authLoading && !isAuthenticated) {
    return (
      <PageContainer colors={colors} insets={insets}>
        <View style={styles.centeredContent}>
          <View style={[styles.iconCircle, { backgroundColor: colors.link + "1A" }]}>
            <Ionicons name="sparkles" size={32} color={colors.link} />
          </View>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Try Togather with your church
          </Text>
          <Text style={[styles.cardMessage, { color: colors.textSecondary }]}>
            Sign in first, then we'll set up a demo community that looks and
            feels like your church — no payment or commitment required.
          </Text>
          <Pressable
            onPress={() => router.push("/(auth)/landing")}
            style={[styles.submitButton, { backgroundColor: colors.buttonPrimary, marginTop: 24, alignSelf: "stretch" }]}
          >
            <Text style={[styles.submitButtonText, { color: colors.buttonPrimaryText }]}>
              Sign in to start
            </Text>
          </Pressable>
        </View>
      </PageContainer>
    );
  }

  // ---- Success state: show the shareable demo code before entering ----
  if (demo) {
    return (
      <PageContainer colors={colors} insets={insets}>
        <View style={styles.centeredContent}>
          <View style={[styles.iconCircle, { backgroundColor: colors.success + "1A" }]}>
            <Ionicons name="checkmark-circle" size={32} color={colors.success} />
          </View>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            {demo.name} is ready!
          </Text>
          <Text style={[styles.cardMessage, { color: colors.textSecondary }]}>
            Your community starts in demo mode, seeded with groups,
            conversations, and events. You're the admin — rename it, re-brand
            it, and click around. Everything works. When you're ready, tap
            "Go live" on the demo banner to add payment ($1/month per active
            member) and open it to your congregation.
          </Text>
          <View
            style={[
              styles.demoCodeBox,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight },
            ]}
          >
            <Text style={[styles.demoCodeLabel, { color: colors.textSecondary }]}>
              Invite your team with this demo code
            </Text>
            <Text
              selectable
              style={[
                styles.demoCodeValue,
                { color: colors.text, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
              ]}
            >
              {demo.demoCode}
            </Text>
            <Text style={[styles.demoCodeHint, { color: colors.textTertiary }]}>
              Anyone who enters this code on the demo page joins as a co-admin.
            </Text>
          </View>
          <Pressable
            onPress={() => enterDemo(demo)}
            disabled={entering}
            style={[styles.submitButton, { backgroundColor: colors.buttonPrimary, alignSelf: "stretch" }]}
          >
            {entering && (
              <ActivityIndicator
                size="small"
                color={colors.buttonPrimaryText}
                style={{ marginRight: 8 }}
              />
            )}
            <Text style={[styles.submitButtonText, { color: colors.buttonPrimaryText }]}>
              Enter your demo
            </Text>
          </Pressable>
          {error && (
            <Text style={[styles.errorText, { color: colors.error, marginTop: 12 }]}>{error}</Text>
          )}
        </View>
      </PageContainer>
    );
  }

  // ---- Questionnaire ----
  return (
    <PageContainer colors={colors} insets={insets}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContainer}>
          <View style={styles.header}>
            <Text style={[styles.heading, { color: colors.text }]}>
              Create your community
            </Text>
            <Text style={[styles.subheading, { color: colors.textSecondary }]}>
              Every community starts in demo mode: answer a few questions and
              we'll build it with your name, branding, and structure — seeded
              with demo members, chats, and events you can explore as the
              admin. Go live whenever you're ready.
            </Text>
          </View>

          {/* About your church */}
          <View
            style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              About your church
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Church name</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text },
                ]}
                value={name}
                onChangeText={setName}
                placeholder="Grace Fellowship"
                placeholderTextColor={colors.inputPlaceholder}
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.fieldGroup, styles.fieldHalf]}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Church size</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text },
                  ]}
                  value={totalSize}
                  onChangeText={setTotalSize}
                  placeholder="250"
                  placeholderTextColor={colors.inputPlaceholder}
                  keyboardType="number-pad"
                />
              </View>
              <View style={[styles.fieldGroup, styles.fieldHalf]}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Campuses</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text },
                  ]}
                  value={campusCount}
                  onChangeText={setCampusCount}
                  placeholder="1"
                  placeholderTextColor={colors.inputPlaceholder}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.fieldGroup, styles.fieldHalf]}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Small groups</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text },
                  ]}
                  value={smallGroupCount}
                  onChangeText={setSmallGroupCount}
                  placeholder="3"
                  placeholderTextColor={colors.inputPlaceholder}
                  keyboardType="number-pad"
                />
              </View>
              <View style={[styles.fieldGroup, styles.fieldHalf]}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Main zip code</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text },
                  ]}
                  value={zipCode}
                  onChangeText={setZipCode}
                  placeholder="11201"
                  placeholderTextColor={colors.inputPlaceholder}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>
          </View>

          {/* Branding */}
          <View
            style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Branding</Text>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Logo <Text style={{ color: colors.textTertiary }}>(optional)</Text>
              </Text>
              <ImagePicker
                onImageSelected={setLogoUri}
                onImageRemoved={() => setLogoUri(null)}
                currentImage={logoUri ?? undefined}
                buttonText="Upload logo"
                aspect={[1, 1]}
              />
            </View>

            <ColorInput
              label="Primary color"
              value={primaryColor}
              onChange={setPrimaryColor}
              colors={colors}
            />
            <ColorInput
              label="Secondary color"
              value={secondaryColor}
              onChange={setSecondaryColor}
              colors={colors}
            />
          </View>

          {error && (
            <View
              style={[
                styles.errorBanner,
                { backgroundColor: colors.error + "10", borderColor: colors.error + "30" },
              ]}
            >
              <Ionicons name="alert-circle" size={20} color={colors.error} style={{ marginRight: 10 }} />
              <Text style={[styles.errorText, { color: colors.error, flex: 1 }]}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={handleCreate}
            disabled={!formValid || submitting}
            style={[
              styles.submitButton,
              { backgroundColor: formValid && !submitting ? colors.buttonPrimary : colors.buttonDisabled },
            ]}
          >
            {submitting && (
              <ActivityIndicator
                size="small"
                color={colors.buttonPrimaryText}
                style={{ marginRight: 8 }}
              />
            )}
            <Text
              style={[
                styles.submitButtonText,
                { color: formValid && !submitting ? colors.buttonPrimaryText : colors.buttonDisabledText },
              ]}
            >
              {submitting ? "Building your community..." : "Create my community"}
            </Text>
          </Pressable>
          <Text style={[styles.footnote, { color: colors.textTertiary }]}>
            Demo mode is free and private — up to 10 teammates can explore it
            with you. Going live later costs $1/month per active member.
          </Text>

          {/* Join an existing demo */}
          <View
            style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Joining a teammate's demo?
            </Text>
            <View style={styles.joinRow}>
              <TextInput
                style={[
                  styles.input,
                  styles.joinInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                  },
                ]}
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder="demo-grace-fellowship"
                placeholderTextColor={colors.inputPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={handleJoin}
                disabled={!joinCode.trim() || joining}
                style={[
                  styles.joinButton,
                  { backgroundColor: joinCode.trim() && !joining ? colors.buttonPrimary : colors.buttonDisabled },
                ]}
              >
                {joining ? (
                  <ActivityIndicator size="small" color={colors.buttonPrimaryText} />
                ) : (
                  <Text
                    style={[
                      styles.submitButtonText,
                      { color: joinCode.trim() ? colors.buttonPrimaryText : colors.buttonDisabledText },
                    ]}
                  >
                    Join
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function PageContainer({
  children,
  colors,
  insets,
}: {
  children: React.ReactNode;
  colors: ReturnType<typeof useTheme>["colors"];
  insets: ReturnType<typeof useSafeAreaInsets>;
}) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      <View
        style={[
          styles.page,
          {
            backgroundColor: colors.backgroundSecondary,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        {children}
      </View>
    </KeyboardAvoidingView>
  );
}

const MAX_WIDTH = 600;

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 32,
  },
  formContainer: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
  },
  centeredContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 64,
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  cardMessage: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  subheading: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 16,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldRow: {
    flexDirection: "row",
    gap: 12,
  },
  fieldHalf: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
  },
  submitButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  footnote: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 24,
  },
  joinRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  joinInput: {
    flex: 1,
  },
  joinButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  demoCodeBox: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    marginTop: 24,
    marginBottom: 24,
    alignSelf: "stretch",
    alignItems: "center",
  },
  demoCodeLabel: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 8,
  },
  demoCodeValue: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  demoCodeHint: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
});
