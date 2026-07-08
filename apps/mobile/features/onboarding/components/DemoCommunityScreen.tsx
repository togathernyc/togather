/**
 * DemoCommunityScreen - Self-serve demo community setup wizard.
 *
 * Route: /onboarding/demo
 *
 * A prospective church walks a short 4-step wizard (about the church, campuses
 * & teams, service times, branding) and instantly gets a private seeded
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
import { ColorPicker } from "@features/admin/components/ColorPicker";
import { geocodeZipCode } from "@features/groups/utils/geocodeLocation";

type ThemeColors = ReturnType<typeof useTheme>["colors"];

// Server caps in functions/demo.ts (MAX_CAMPUSES / MAX_SMALL_GROUPS): we only
// build named entries up to this many. Keep in sync with the backend.
const MAX_NAMED_ITEMS = 12;

const TOTAL_STEPS = 4;
const STEP_TITLES = [
  "About your church",
  "Campuses & teams",
  "Service times",
  "Branding",
];

// Team prefill defaults. Single-campus churches get one flat list; multi-campus
// churches split into centralized (one shared group) vs per-campus (a channel
// per location) teams.
const DEFAULT_SINGLE_TEAMS = [
  "Worship Team",
  "Welcome Team",
  "Production Team",
  "Kids Team",
  "Prayer Team",
];
const DEFAULT_CENTRALIZED_TEAMS = ["Worship Team", "Production Team", "Kids Team"];
const DEFAULT_PER_CAMPUS_TEAMS = ["Welcome Team", "Prayer Team"];

// Prefilled Sunday service times for every campus.
const DEFAULT_SERVICE_TIMES = ["9:00 AM", "11:00 AM"];

type ServiceTime = { label: string; hour: number; minute: number };

type DemoResult = {
  communityId: string;
  name: string;
  logo: string | null;
  demoCode: string;
};

/** Parse a free-form time label ("9:00 AM") to a { label, hour(0-23), minute }. */
function parseTimeLabel(raw: string): ServiceTime | null {
  const label = raw.trim();
  if (!label) return null;
  const match = label.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  let hour = 0;
  let minute = 0;
  if (match) {
    hour = parseInt(match[1], 10);
    minute = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  hour = Math.max(0, Math.min(23, hour));
  minute = Math.max(0, Math.min(59, minute));
  return { label, hour, minute };
}

function parseCount(value: string): number | undefined {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function DemoCommunityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isAuthenticated, isLoading: authLoading, setCommunity, refreshUser } = useAuth();

  const createDemo = useAuthenticatedMutation(api.functions.demo.createDemoCommunity);
  const joinDemo = useAuthenticatedMutation(api.functions.demo.joinDemoCommunity);
  const getR2UploadUrl = useAuthenticatedAction(api.functions.uploads.getR2UploadUrl);
  const selectCommunityMutation = useSelectCommunity();

  // ---- Wizard step ----
  const [step, setStep] = useState(0);

  // ---- Step 1: About your church ----
  const [name, setName] = useState("");
  const [totalSize, setTotalSize] = useState("");
  const [zipCode, setZipCode] = useState("");

  // ---- Step 2: Campuses & teams ----
  const [campusCount, setCampusCount] = useState("");
  const [campusChips, setCampusChips] = useState<string[]>([]);
  const [smallGroupCount, setSmallGroupCount] = useState("");
  const [teams, setTeams] = useState<string[]>(DEFAULT_SINGLE_TEAMS);
  const [centralizedTeams, setCentralizedTeams] = useState<string[]>(
    DEFAULT_CENTRALIZED_TEAMS,
  );
  const [perCampusTeams, setPerCampusTeams] = useState<string[]>(
    DEFAULT_PER_CAMPUS_TEAMS,
  );

  // ---- Step 3: Service times (keyed by campus index) ----
  const [serviceTimes, setServiceTimes] = useState<Record<number, string[]>>({});

  // ---- Step 4: Branding ----
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState("#1E8449");

  // ---- Join-by-code state ----
  const [joinCode, setJoinCode] = useState("");

  // ---- Submission state ----
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoResult | null>(null);

  // How many campuses this church has. The chip list length OR the numeric
  // field (whichever is larger) drives it; at least 1. Capped so we never
  // render an unbounded number of service-time blocks (server clamps too).
  const cleanCampusChips = campusChips.map((c) => c.trim()).filter(Boolean);
  const effectiveCampusCount = Math.min(
    Math.max(parseCount(campusCount) ?? 1, cleanCampusChips.length, 1),
    MAX_NAMED_ITEMS,
  );
  const oneCampus = effectiveCampusCount === 1;

  // Name is the only required field (ColorPicker only emits valid hex; the
  // server re-validates everything). Gates the step-1 "Next" button.
  const step1Valid = name.trim().length > 0;
  const formValid = step1Valid;

  const getCampusTimes = (index: number) =>
    serviceTimes[index] ?? DEFAULT_SERVICE_TIMES;
  const setCampusTimes = (index: number, next: string[]) =>
    setServiceTimes((prev) => ({ ...prev, [index]: next }));

  const campusLabel = (index: number) => {
    if (oneCampus) return "Your services";
    return cleanCampusChips[index] || `Campus ${index + 1}`;
  };

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

  async function handleCreate() {
    if (!formValid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const logo = logoUri ? await uploadLogo(logoUri) : undefined;
      // Best-effort: resolve the zip to coordinates (bundled US zip database)
      // so seeded groups and events land on the map around their area.
      const coords = geocodeZipCode(zipCode.trim() || null);
      const cleanNames = (names: string[]) =>
        names.map((n) => n.trim()).filter((n) => n.length > 0);

      // One structured entry per campus: its chip name (if provided) plus the
      // service times collected for it. Length = max(count field, chips), >= 1.
      const campusesArray = Array.from({ length: effectiveCampusCount }).map(
        (_, i) => {
          const times = getCampusTimes(i)
            .map(parseTimeLabel)
            .filter((t): t is ServiceTime => t !== null);
          const campusName = cleanCampusChips[i];
          return {
            name: campusName || undefined,
            serviceTimes: times.length > 0 ? times : undefined,
          };
        },
      );

      const teamsList = cleanNames(teams);
      const centralizedList = cleanNames(centralizedTeams);
      const perCampusList = cleanNames(perCampusTeams);

      const result = await createDemo({
        name: name.trim(),
        totalSize: parseCount(totalSize),
        zipCode: zipCode.trim() || undefined,
        logo,
        primaryColor,
        baseCoordinates: coords ?? undefined,
        smallGroupCount: parseCount(smallGroupCount),
        // Structured campuses are authoritative for campus count when present.
        campuses: campusesArray,
        // Fallback count when no campus chips were added but a number was typed.
        campusCount: parseCount(campusCount),
        // Team arrays only for the relevant mode; empty lists fall back to
        // server defaults.
        teams: oneCampus && teamsList.length > 0 ? teamsList : undefined,
        centralizedTeams:
          !oneCampus && centralizedList.length > 0 ? centralizedList : undefined,
        perCampusTeams:
          !oneCampus && perCampusList.length > 0 ? perCampusList : undefined,
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

  const canProceed = step === 0 ? step1Valid : true;

  // ---- Wizard ----
  return (
    <PageContainer colors={colors} insets={insets}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContainer}>
          {/* Step indicator + title */}
          <View style={styles.header}>
            <View style={styles.dotsRow}>
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    { backgroundColor: i === step ? colors.buttonPrimary : colors.border },
                    i === step && styles.dotActive,
                  ]}
                />
              ))}
            </View>
            <Text style={[styles.stepCounter, { color: colors.textTertiary }]}>
              Step {step + 1} of {TOTAL_STEPS}
            </Text>
            <Text style={[styles.heading, { color: colors.text }]}>
              {STEP_TITLES[step]}
            </Text>
          </View>

          {step === 0 && (
            <StepAboutChurch
              colors={colors}
              name={name}
              setName={setName}
              totalSize={totalSize}
              setTotalSize={setTotalSize}
              zipCode={zipCode}
              setZipCode={setZipCode}
            />
          )}

          {step === 1 && (
            <StepCampusesAndTeams
              colors={colors}
              campusCount={campusCount}
              setCampusCount={setCampusCount}
              campusChips={campusChips}
              setCampusChips={setCampusChips}
              smallGroupCount={smallGroupCount}
              setSmallGroupCount={setSmallGroupCount}
              oneCampus={oneCampus}
              teams={teams}
              setTeams={setTeams}
              centralizedTeams={centralizedTeams}
              setCentralizedTeams={setCentralizedTeams}
              perCampusTeams={perCampusTeams}
              setPerCampusTeams={setPerCampusTeams}
            />
          )}

          {step === 2 && (
            <StepServiceTimes
              colors={colors}
              campusCount={effectiveCampusCount}
              campusLabel={campusLabel}
              getCampusTimes={getCampusTimes}
              setCampusTimes={setCampusTimes}
            />
          )}

          {step === 3 && (
            <StepBranding
              colors={colors}
              logoUri={logoUri}
              setLogoUri={setLogoUri}
              primaryColor={primaryColor}
              setPrimaryColor={setPrimaryColor}
              error={error}
            />
          )}

          {/* Navigation */}
          <View style={styles.navRow}>
            {step > 0 ? (
              <Pressable
                onPress={() => setStep((s) => Math.max(0, s - 1))}
                style={[styles.navButton, styles.backButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
              </Pressable>
            ) : (
              <View style={styles.navSpacer} />
            )}

            {step < TOTAL_STEPS - 1 ? (
              <Pressable
                onPress={() => canProceed && setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))}
                disabled={!canProceed}
                style={[
                  styles.navButton,
                  { backgroundColor: canProceed ? colors.buttonPrimary : colors.buttonDisabled },
                ]}
              >
                <Text
                  style={[
                    styles.navButtonText,
                    { color: canProceed ? colors.buttonPrimaryText : colors.buttonDisabledText },
                  ]}
                >
                  Next
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleCreate}
                disabled={!formValid || submitting}
                style={[
                  styles.navButton,
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
                    styles.navButtonText,
                    { color: formValid && !submitting ? colors.buttonPrimaryText : colors.buttonDisabledText },
                  ]}
                >
                  {submitting ? "Building your community..." : "Create my community"}
                </Text>
              </Pressable>
            )}
          </View>

          {step === 0 && (
            <>
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
                {/* Join-by-code errors surface here — the create-flow error
                    banner only renders on the Branding step, so without this a
                    failed join on step 0 would look like a no-op. */}
                {error && (
                  <Text style={[styles.errorText, { color: colors.error, marginTop: 12 }]}>{error}</Text>
                )}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — About your church
// ---------------------------------------------------------------------------

function StepAboutChurch({
  colors,
  name,
  setName,
  totalSize,
  setTotalSize,
  zipCode,
  setZipCode,
}: {
  colors: ThemeColors;
  name: string;
  setName: (v: string) => void;
  totalSize: string;
  setTotalSize: (v: string) => void;
  zipCode: string;
  setZipCode: (v: string) => void;
}) {
  return (
    <>
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Church name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
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
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              value={totalSize}
              onChangeText={setTotalSize}
              placeholder="250"
              placeholderTextColor={colors.inputPlaceholder}
              keyboardType="number-pad"
            />
          </View>
          <View style={[styles.fieldGroup, styles.fieldHalf]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Main zip code</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
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

      {/* Informational callout — guidance, not an input. */}
      <View
        style={[styles.callout, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight }]}
      >
        <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} style={styles.calloutIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.calloutText, { color: colors.textSecondary }]}>
            One community can hold up to 1,000,000 people — but this demo is
            capped at 100 sample members so it stays fast to explore.
          </Text>
          <Text style={[styles.calloutHeading, { color: colors.text }]}>
            One community, or several?
          </Text>
          <Text style={[styles.calloutText, { color: colors.textSecondary }]}>
            Put campuses people can reasonably commute between in ONE community
            (e.g. Brooklyn / Queens / Manhattan, or DC / Maryland / Virginia),
            and keep the community name broad enough to cover them all. If
            locations are far apart — different states or regions like Maryland
            vs. New York — create SEPARATE communities instead.
          </Text>
        </View>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Campuses & teams
// ---------------------------------------------------------------------------

function StepCampusesAndTeams({
  colors,
  campusCount,
  setCampusCount,
  campusChips,
  setCampusChips,
  smallGroupCount,
  setSmallGroupCount,
  oneCampus,
  teams,
  setTeams,
  centralizedTeams,
  setCentralizedTeams,
  perCampusTeams,
  setPerCampusTeams,
}: {
  colors: ThemeColors;
  campusCount: string;
  setCampusCount: (v: string) => void;
  campusChips: string[];
  setCampusChips: React.Dispatch<React.SetStateAction<string[]>>;
  smallGroupCount: string;
  setSmallGroupCount: (v: string) => void;
  oneCampus: boolean;
  teams: string[];
  setTeams: React.Dispatch<React.SetStateAction<string[]>>;
  centralizedTeams: string[];
  setCentralizedTeams: React.Dispatch<React.SetStateAction<string[]>>;
  perCampusTeams: string[];
  setPerCampusTeams: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <>
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
        <View style={styles.fieldRow}>
          <View style={[styles.fieldGroup, styles.fieldHalf]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Number of campuses</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              value={campusCount}
              onChangeText={setCampusCount}
              placeholder="1"
              placeholderTextColor={colors.inputPlaceholder}
              keyboardType="number-pad"
            />
          </View>
          <View style={[styles.fieldGroup, styles.fieldHalf]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Small groups</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              value={smallGroupCount}
              onChangeText={setSmallGroupCount}
              placeholder="3"
              placeholderTextColor={colors.inputPlaceholder}
              keyboardType="number-pad"
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Campus names <Text style={{ color: colors.textTertiary }}>(optional)</Text>
          </Text>
          <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
            Add the campuses you have — we'll fill any remaining spots with
            placeholder names you can rename later.
          </Text>
          <PillList
            colors={colors}
            items={campusChips}
            setItems={setCampusChips}
            placeholder="Add a campus (e.g. Brooklyn)"
          />
        </View>
      </View>

      {oneCampus ? (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Teams</Text>
          <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
            These become their own team groups. Remove any you don't have and
            add your own.
          </Text>
          <PillList colors={colors} items={teams} setItems={setTeams} placeholder="Add a team" />
        </View>
      ) : (
        <>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Centralized teams (shared across campuses)
            </Text>
            <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
              One group each, with leadership shared across all campuses.
            </Text>
            <PillList
              colors={colors}
              items={centralizedTeams}
              setItems={setCentralizedTeams}
              placeholder="Add a centralized team"
            />
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Teams at each campus</Text>
            <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
              Each campus gets its own channel for these — organized locally per
              location.
            </Text>
            <PillList
              colors={colors}
              items={perCampusTeams}
              setItems={setPerCampusTeams}
              placeholder="Add a per-campus team"
            />
          </View>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Service times
// ---------------------------------------------------------------------------

function StepServiceTimes({
  colors,
  campusCount,
  campusLabel,
  getCampusTimes,
  setCampusTimes,
}: {
  colors: ThemeColors;
  campusCount: number;
  campusLabel: (index: number) => string;
  getCampusTimes: (index: number) => string[];
  setCampusTimes: (index: number, next: string[]) => void;
}) {
  return (
    <>
      <View style={[styles.callout, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight }]}>
        <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} style={styles.calloutIcon} />
        <Text style={[styles.calloutText, { color: colors.textSecondary, flex: 1 }]}>
          We'll pre-build the next 6 Sundays — service plans, run sheets,
          serving assignments — using these times, so you can try rostering
          right away.
        </Text>
      </View>

      {Array.from({ length: campusCount }).map((_, i) => (
        <View
          key={i}
          style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{campusLabel(i)}</Text>
          <ServiceTimeList
            colors={colors}
            labels={getCampusTimes(i)}
            onChange={(next) => setCampusTimes(i, next)}
          />
        </View>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Branding
// ---------------------------------------------------------------------------

function StepBranding({
  colors,
  logoUri,
  setLogoUri,
  primaryColor,
  setPrimaryColor,
  error,
}: {
  colors: ThemeColors;
  logoUri: string | null;
  setLogoUri: (v: string | null) => void;
  primaryColor: string;
  setPrimaryColor: (v: string) => void;
  error: string | null;
}) {
  return (
    <>
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
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

        <ColorPicker
          label="Brand color"
          value={primaryColor}
          onChange={setPrimaryColor}
          defaultColor="#1E8449"
        />
        <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
          This colors buttons, tabs, and highlights — with white text on top —
          so richer, darker shades work best. Every preset in the picker looks
          great; very light or neon colors won't.
        </Text>
      </View>

      {error && (
        <View
          style={[styles.errorBanner, { backgroundColor: colors.error + "10", borderColor: colors.error + "30" }]}
        >
          <Ionicons name="alert-circle" size={20} color={colors.error} style={{ marginRight: 10 }} />
          <Text style={[styles.errorText, { color: colors.error, flex: 1 }]}>{error}</Text>
        </View>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared local pieces
// ---------------------------------------------------------------------------

/**
 * A removable-chip / pill list with an inline "Add" input. Modeled on the
 * HostsPicker chips row (flexWrap row, rounded pill, Ionicons "close" remove).
 */
function PillList({
  colors,
  items,
  setItems,
  placeholder,
  max = MAX_NAMED_ITEMS,
}: {
  colors: ThemeColors;
  items: string[];
  setItems: React.Dispatch<React.SetStateAction<string[]>>;
  placeholder: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const atCap = items.length >= max;

  const add = () => {
    const value = draft.trim();
    if (!value || atCap) return;
    setItems((prev) => [...prev, value]);
    setDraft("");
  };
  const removeAt = (index: number) =>
    setItems((prev) => prev.filter((_, i) => i !== index));

  return (
    <View>
      {items.length > 0 && (
        <View style={styles.chipsRow}>
          {items.map((item, i) => (
            <View
              key={`${item}-${i}`}
              style={[styles.chip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            >
              <Text style={[styles.chipText, { color: colors.text }]} numberOfLines={1}>
                {item}
              </Text>
              <Pressable
                onPress={() => removeAt(i)}
                hitSlop={8}
                style={styles.chipRemove}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item}`}
              >
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={styles.addRow}>
        <TextInput
          style={[
            styles.input,
            styles.addInput,
            { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text },
          ]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder={atCap ? "Maximum reached" : placeholder}
          placeholderTextColor={colors.inputPlaceholder}
          editable={!atCap}
          returnKeyType="done"
        />
        <Pressable
          onPress={add}
          disabled={!draft.trim() || atCap}
          style={[
            styles.addButton,
            { backgroundColor: draft.trim() && !atCap ? colors.buttonPrimary : colors.buttonDisabled },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Add"
        >
          <Text
            style={[
              styles.addButtonText,
              { color: draft.trim() && !atCap ? colors.buttonPrimaryText : colors.buttonDisabledText },
            ]}
          >
            Add
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Editable, removable list of service-time labels for one campus. */
function ServiceTimeList({
  colors,
  labels,
  onChange,
}: {
  colors: ThemeColors;
  labels: string[];
  onChange: (next: string[]) => void;
}) {
  const setAt = (index: number, value: string) =>
    onChange(labels.map((label, i) => (i === index ? value : label)));
  const removeAt = (index: number) =>
    onChange(labels.filter((_, i) => i !== index));
  const add = () => onChange([...labels, ""]);

  return (
    <View>
      {labels.map((label, i) => (
        <View key={i} style={styles.timeRow}>
          <TextInput
            style={[
              styles.input,
              styles.timeInput,
              { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text },
            ]}
            value={label}
            onChangeText={(v) => setAt(i, v)}
            placeholder="9:00 AM"
            placeholderTextColor={colors.inputPlaceholder}
          />
          <Pressable
            onPress={() => removeAt(i)}
            hitSlop={8}
            style={styles.timeRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label || "time"}`}
          >
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={add}
        style={[styles.addTimeButton, { borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel="Add time"
      >
        <Ionicons name="add" size={16} color={colors.text} />
        <Text style={[styles.addButtonText, { color: colors.text }]}>Add time</Text>
      </Pressable>
    </View>
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
  colors: ThemeColors;
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
    marginBottom: 24,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 22,
  },
  stepCounter: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 6,
  },
  heading: {
    fontSize: 26,
    fontWeight: "700",
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
    marginBottom: 8,
  },
  callout: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    gap: 10,
  },
  calloutIcon: {
    marginTop: 1,
  },
  calloutHeading: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 12,
    marginBottom: 4,
  },
  calloutText: {
    fontSize: 13,
    lineHeight: 19,
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
  fieldHint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "100%",
  },
  chipText: {
    fontSize: 14,
    marginRight: 6,
    maxWidth: 200,
  },
  chipRemove: {
    padding: 2,
  },
  addRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  addInput: {
    flex: 1,
  },
  addButton: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  timeInput: {
    flex: 1,
  },
  timeRemove: {
    padding: 6,
  },
  addTimeButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
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
  navRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  navSpacer: {
    flex: 1,
  },
  navButton: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  backButton: {
    borderWidth: 1,
  },
  navButtonText: {
    fontSize: 15,
    fontWeight: "600",
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
