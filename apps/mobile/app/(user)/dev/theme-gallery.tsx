/**
 * Theme Gallery - Developer tool for visual dark mode verification.
 *
 * Renders every UI component and layout pattern with dummy data.
 * Includes a Light/Dark/Auto mode toggle so developers can verify
 * dark mode across the entire component library without navigating the real app.
 */

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Platform,
  Alert,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useTheme } from "@hooks/useTheme";
import {
  ThemeContext,
  type ColorScheme,
  type ThemePreference,
} from "@providers/ThemeProvider";
import {
  lightColors,
  darkColors,
  type ThemeColors,
} from "@/theme/colors";
import {
  Button,
  Card,
  Modal,
  Input,
  FormInput,
  Badge,
  ToastContainer,
  ToastManager,
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  EmptyState,
  Select,
  SearchBar,
  Switch,
  ProgressBar,
  DatePicker,
  ConfirmModal,
  AppImage,
} from "@components/ui";
import { OTPInput } from "@components/ui/OTPInput";
import { PhoneInput } from "@components/ui/PhoneInput";
import { CalendarGrid } from "@components/ui/CalendarGrid";

// ---------------------------------------------------------------------------
// Form schema for FormInput demo
// ---------------------------------------------------------------------------
const demoFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
});

// ---------------------------------------------------------------------------
// Section wrapper - themed
// ---------------------------------------------------------------------------
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        marginBottom: 24,
        padding: 20,
        backgroundColor: colors.surface,
        borderRadius: 12,
        ...Platform.select({
          web: {
            boxShadow: `0px 2px 8px ${colors.shadow}20`,
          } as any,
          default: {
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 8,
            elevation: 3,
          },
        }),
      }}
    >
      <Text
        style={{
          fontSize: 20,
          fontWeight: "600",
          color: colors.text,
          marginBottom: 16,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Color Tokens Grid
// ---------------------------------------------------------------------------
function ColorTokensGrid() {
  const { colors } = useTheme();
  const tokenEntries = Object.entries(colors) as [keyof ThemeColors, string][];

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {tokenEntries.map(([name, value]) => (
        <View
          key={name}
          style={{
            width: "47%",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              backgroundColor: value,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                color: colors.text,
              }}
            >
              {name}
            </Text>
            <Text
              style={{
                fontSize: 10,
                color: colors.textTertiary,
                fontFamily:
                  Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
            >
              {value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Gallery Content (rendered inside ThemeContext override)
// ---------------------------------------------------------------------------
function GalleryContent() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Component state
  const [modalVisible, setModalVisible] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [switchValue, setSwitchValue] = useState(false);
  const [progress, setProgress] = useState(0.6);
  const [selectedValue, setSelectedValue] = useState<string | number>("");
  const [searchValue, setSearchValue] = useState("");
  const [dateValue, setDateValue] = useState<Date | null>(null);
  const [otpValue, setOtpValue] = useState("");
  const [phoneValue, setPhoneValue] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [inputValue, setInputValue] = useState("");

  const selectOptions = [
    { label: "Youth Group", value: "1" },
    { label: "Small Group", value: "2" },
    { label: "Worship Team", value: "3" },
    { label: "Sunday School", value: "4" },
  ];

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(demoFormSchema),
    defaultValues: { name: "", email: "" },
  });

  const onSubmit = (data: any) => {
    Alert.alert("Form Submitted", JSON.stringify(data));
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: 16,
        paddingBottom: insets.bottom + 40,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {/* ---- Color Tokens ---- */}
      <Section title="Color Tokens">
        <ColorTokensGrid />
      </Section>

      {/* ---- Buttons ---- */}
      <Section title="Buttons">
        <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
          <Button onPress={() => {}} variant="primary">
            Primary
          </Button>
          <Button onPress={() => {}} variant="secondary">
            Secondary
          </Button>
          <Button onPress={() => {}} variant="danger">
            Danger
          </Button>
        </View>
        <Button onPress={() => {}} loading>
          Loading
        </Button>
        <View style={{ height: 8 }} />
        <Button onPress={() => {}} disabled>
          Disabled
        </Button>
      </Section>

      {/* ---- Cards ---- */}
      <Section title="Cards">
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <Text style={{ fontSize: 16, color: colors.text }}>
            Basic card component
          </Text>
        </Card>
        <Card
          onPress={() => Alert.alert("Pressed")}
          style={{ padding: 16 }}
        >
          <Text style={{ fontSize: 16, color: colors.text }}>
            Pressable card
          </Text>
        </Card>
      </Section>

      {/* ---- Inputs ---- */}
      <Section title="Inputs">
        <Input
          label="Regular Input"
          placeholder="Enter text"
          value={inputValue}
          onChangeText={setInputValue}
        />
        <Input
          label="Password"
          placeholder="Enter password"
          value=""
          onChangeText={() => {}}
          secureTextEntry
          required
        />
        <Input
          label="Error State"
          placeholder="Enter email"
          value=""
          onChangeText={() => {}}
          error="This field is required"
          required
        />
      </Section>

      {/* ---- FormInput ---- */}
      <Section title="FormInput (with validation)">
        <FormInput
          name="name"
          control={control}
          label="Name"
          placeholder="Enter your name"
          required
          error={errors.name}
        />
        <FormInput
          name="email"
          control={control}
          label="Email"
          placeholder="Enter your email"
          required
          error={errors.email}
          keyboardType="email-address"
        />
        <Button
          onPress={handleSubmit(onSubmit)}
          variant="primary"
          style={{ marginTop: 12 }}
        >
          Submit Form
        </Button>
      </Section>

      {/* ---- SearchBar ---- */}
      <Section title="SearchBar">
        <SearchBar
          placeholder="Search..."
          value={searchValue}
          onChangeText={setSearchValue}
          onSearch={(text) => Alert.alert("Search", text)}
        />
      </Section>

      {/* ---- Select ---- */}
      <Section title="Select">
        <Select
          label="Select Option"
          placeholder="Choose an option"
          value={selectedValue}
          options={selectOptions}
          onSelect={setSelectedValue}
          required
        />
        <Select
          label="Searchable Select"
          placeholder="Search and select"
          value={selectedValue}
          options={selectOptions}
          onSelect={setSelectedValue}
          searchable
        />
      </Section>

      {/* ---- Switch ---- */}
      <Section title="Switch">
        <Switch
          label="Enable notifications"
          value={switchValue}
          onValueChange={setSwitchValue}
        />
        <Switch
          label="Dark mode"
          value={!switchValue}
          onValueChange={(val) => setSwitchValue(!val)}
        />
        <Switch
          label="Disabled switch"
          value={true}
          onValueChange={() => {}}
          disabled
        />
      </Section>

      {/* ---- Badge ---- */}
      <Section title="Badge">
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Badge variant="primary">Primary</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="primary" size="small">
            Small
          </Badge>
          <Badge variant="primary" size="large">
            Large
          </Badge>
        </View>
      </Section>

      {/* ---- ProgressBar ---- */}
      <Section title="ProgressBar">
        <ProgressBar progress={progress} showPercentage />
        <View
          style={{
            flexDirection: "row",
            marginTop: 16,
            gap: 12,
          }}
        >
          <Button
            onPress={() => setProgress(Math.max(0, progress - 0.1))}
            variant="secondary"
            style={{ flex: 1 }}
          >
            Decrease
          </Button>
          <Button
            onPress={() => setProgress(Math.min(1, progress + 0.1))}
            variant="secondary"
            style={{ flex: 1 }}
          >
            Increase
          </Button>
        </View>
      </Section>

      {/* ---- DatePicker ---- */}
      <Section title="DatePicker">
        <DatePicker
          label="Select Date"
          value={dateValue}
          onChange={setDateValue}
          placeholder="Choose a date"
          required
        />
        <DatePicker
          label="Select Time"
          value={dateValue}
          onChange={setDateValue}
          placeholder="Choose a time"
          mode="time"
        />
      </Section>

      {/* ---- Modal + ConfirmModal ---- */}
      <Section title="Modal + ConfirmModal">
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Button
            onPress={() => setModalVisible(true)}
            variant="primary"
            style={{ flex: 1 }}
          >
            Open Modal
          </Button>
          <Button
            onPress={() => setConfirmModalVisible(true)}
            variant="secondary"
            style={{ flex: 1 }}
          >
            Confirm Modal
          </Button>
        </View>
        <Modal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          title="Test Modal"
        >
          <Text
            style={{
              fontSize: 16,
              color: colors.text,
              marginBottom: 8,
              lineHeight: 24,
            }}
          >
            This is a modal component. You can close it by pressing the
            X or tapping outside.
          </Text>
          <Button
            onPress={() => setModalVisible(false)}
            variant="primary"
            style={{ marginTop: 16 }}
          >
            Close Modal
          </Button>
        </Modal>
        <ConfirmModal
          visible={confirmModalVisible}
          title="Delete Item?"
          message="Are you sure you want to delete this item? This action cannot be undone."
          onConfirm={() => setConfirmModalVisible(false)}
          onCancel={() => setConfirmModalVisible(false)}
          confirmText="Delete"
          cancelText="Cancel"
          destructive
        />
      </Section>

      {/* ---- Toast ---- */}
      <Section title="Toast">
        <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
          <Button
            onPress={() => ToastManager.success("Success message!")}
            variant="primary"
            style={{ flex: 1 }}
          >
            Success
          </Button>
          <Button
            onPress={() => ToastManager.error("Error message!")}
            variant="danger"
            style={{ flex: 1 }}
          >
            Error
          </Button>
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Button
            onPress={() => ToastManager.warning("Warning message!")}
            variant="secondary"
            style={{ flex: 1 }}
          >
            Warning
          </Button>
          <Button
            onPress={() => ToastManager.info("Info message!")}
            variant="secondary"
            style={{ flex: 1 }}
          >
            Info
          </Button>
        </View>
      </Section>

      {/* ---- Skeleton / Loading ---- */}
      <Section title="Skeleton / Loading">
        <Skeleton width={200} height={20} style={{ marginBottom: 16 }} />
        <SkeletonText lines={3} style={{ marginBottom: 16 }} />
        <SkeletonAvatar size={64} style={{ marginBottom: 16 }} />
        <SkeletonCard />
      </Section>

      {/* ---- EmptyState ---- */}
      <Section title="EmptyState">
        <EmptyState
          icon="document-outline"
          title="No items found"
          message="Try adjusting your search or filters"
          actionLabel="Refresh"
          onAction={() => Alert.alert("Refresh clicked")}
        />
      </Section>

      {/* ---- OTPInput ---- */}
      <Section title="OTPInput">
        <OTPInput
          length={6}
          value={otpValue}
          onChange={setOtpValue}
          autoFocus={false}
        />
        <Text
          style={{
            fontSize: 12,
            color: colors.textTertiary,
            textAlign: "center",
          }}
        >
          Current value: "{otpValue}"
        </Text>
      </Section>

      {/* ---- PhoneInput ---- */}
      <Section title="PhoneInput">
        <PhoneInput
          value={phoneValue}
          onChangeText={setPhoneValue}
          countryCode={countryCode}
          onCountryCodeChange={setCountryCode}
          placeholder="Phone number"
        />
      </Section>

      {/* ---- CalendarGrid ---- */}
      <Section title="CalendarGrid">
        <CalendarGrid
          selectedDate={calendarDate}
          onDateSelect={setCalendarDate}
          minimumDate={new Date(2020, 0, 1)}
        />
      </Section>

      {/* ---- AppImage ---- */}
      <Section title="AppImage">
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <AppImage
            source="https://via.placeholder.com/80"
            style={{ width: 80, height: 80, borderRadius: 12 }}
          />
          <AppImage
            source="https://via.placeholder.com/80"
            style={{ width: 80, height: 80, borderRadius: 40 }}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 14 }}>
              Square and circular AppImage variants
            </Text>
          </View>
        </View>
      </Section>

      {/* ================================================================ */}
      {/* COMPOSED VIGNETTES                                               */}
      {/* ================================================================ */}

      <Text
        style={{
          fontSize: 24,
          fontWeight: "700",
          color: colors.text,
          marginTop: 16,
          marginBottom: 16,
        }}
      >
        Composed Vignettes
      </Text>

      {/* ---- Chat Bubbles ---- */}
      <Section title="Chat Bubbles">
        <View style={{ gap: 8 }}>
          {/* Other's message */}
          <View style={{ alignSelf: "flex-start", maxWidth: "75%" }}>
            <Text
              style={{
                fontSize: 12,
                color: colors.textSecondary,
                marginBottom: 2,
              }}
            >
              Sarah
            </Text>
            <View
              style={{
                backgroundColor: colors.chatBubbleOther,
                borderRadius: 16,
                padding: 12,
              }}
            >
              <Text style={{ color: colors.chatBubbleOtherText }}>
                Hey! Are we still meeting tomorrow?
              </Text>
            </View>
            <Text
              style={{
                fontSize: 10,
                color: colors.textTertiary,
                marginTop: 2,
              }}
            >
              2:30 PM
            </Text>
          </View>
          {/* Own message */}
          <View style={{ alignSelf: "flex-end", maxWidth: "75%" }}>
            <View
              style={{
                backgroundColor: colors.chatBubbleOwn,
                borderRadius: 16,
                padding: 12,
              }}
            >
              <Text style={{ color: colors.chatBubbleOwnText }}>
                Yes! See you at 3pm at the coffee shop
              </Text>
            </View>
            <Text
              style={{
                fontSize: 10,
                color: colors.textTertiary,
                marginTop: 2,
                alignSelf: "flex-end",
              }}
            >
              2:31 PM
            </Text>
          </View>
          {/* Another other message */}
          <View style={{ alignSelf: "flex-start", maxWidth: "75%" }}>
            <Text
              style={{
                fontSize: 12,
                color: colors.textSecondary,
                marginBottom: 2,
              }}
            >
              Sarah
            </Text>
            <View
              style={{
                backgroundColor: colors.chatBubbleOther,
                borderRadius: 16,
                padding: 12,
              }}
            >
              <Text style={{ color: colors.chatBubbleOtherText }}>
                Sounds great! I'll bring the notes from last week's study
              </Text>
            </View>
            <Text
              style={{
                fontSize: 10,
                color: colors.textTertiary,
                marginTop: 2,
              }}
            >
              2:32 PM
            </Text>
          </View>
        </View>
      </Section>

      {/* ---- Settings Rows ---- */}
      <Section title="Settings Rows">
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Ionicons
              name="notifications-outline"
              size={20}
              color={colors.icon}
            />
            <Text
              style={{ flex: 1, marginLeft: 12, color: colors.text }}
            >
              Notifications
            </Text>
            <Switch value={true} onValueChange={() => {}} />
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Ionicons
              name="lock-closed-outline"
              size={20}
              color={colors.icon}
            />
            <Text
              style={{ flex: 1, marginLeft: 12, color: colors.text }}
            >
              Privacy
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.iconSecondary}
            />
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 16,
            }}
          >
            <Ionicons
              name="trash-outline"
              size={20}
              color={colors.destructive}
            />
            <Text
              style={{
                flex: 1,
                marginLeft: 12,
                color: colors.destructive,
              }}
            >
              Delete Account
            </Text>
          </View>
        </View>
      </Section>

      {/* ---- Inbox List Item ---- */}
      <Section title="Inbox List Item">
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 12,
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: colors.surfaceSecondary,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontWeight: "600",
                fontSize: 18,
              }}
            >
              YG
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontWeight: "600",
                fontSize: 16,
              }}
            >
              Youth Group
            </Text>
            <Text
              style={{ color: colors.textSecondary, fontSize: 14 }}
              numberOfLines={1}
            >
              Alex: See you all tomorrow!
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <Text
              style={{ color: colors.textTertiary, fontSize: 12 }}
            >
              2:45 PM
            </Text>
            <View
              style={{
                backgroundColor: colors.error,
                borderRadius: 10,
                minWidth: 20,
                height: 20,
                justifyContent: "center",
                alignItems: "center",
                paddingHorizontal: 6,
              }}
            >
              <Text
                style={{
                  color: colors.textInverse,
                  fontSize: 11,
                  fontWeight: "700",
                }}
              >
                3
              </Text>
            </View>
          </View>
        </View>
      </Section>

      {/* ---- Form Section ---- */}
      <Section title="Form Section">
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 12,
            padding: 16,
            gap: 12,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontWeight: "600",
              fontSize: 18,
            }}
          >
            Create Event
          </Text>
          <Input
            label="Event Name"
            placeholder="Enter event name"
            value=""
            onChangeText={() => {}}
          />
          <Select
            label="Group"
            placeholder="Select a group"
            value=""
            options={[
              { label: "Youth Group", value: "1" },
              { label: "Small Group", value: "2" },
            ]}
            onSelect={() => {}}
          />
          <Button variant="primary" onPress={() => {}}>
            Create Event
          </Button>
        </View>
      </Section>

      {/* ---- Profile Header ---- */}
      <Section title="Profile Header">
        <View style={{ alignItems: "center", padding: 24, gap: 8 }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: colors.link,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: colors.textInverse,
                fontSize: 28,
                fontWeight: "700",
              }}
            >
              JD
            </Text>
          </View>
          <Text
            style={{
              color: colors.text,
              fontSize: 22,
              fontWeight: "700",
            }}
          >
            John Doe
          </Text>
          <Text
            style={{ color: colors.textSecondary, fontSize: 14 }}
          >
            john.doe@example.com
          </Text>
        </View>
      </Section>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Mode Toggle (sticky header)
// ---------------------------------------------------------------------------
type ThemeMode = "auto" | "light" | "dark";

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: ThemeMode;
  onModeChange: (m: ThemeMode) => void;
}) {
  const { colors } = useTheme();
  const modes: ThemeMode[] = ["auto", "light", "dark"];

  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: colors.surfaceSecondary,
        borderRadius: 10,
        padding: 4,
      }}
    >
      {modes.map((m) => {
        const isSelected = m === mode;
        return (
          <Pressable
            key={m}
            onPress={() => onModeChange(m)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 8,
              alignItems: "center",
              backgroundColor: isSelected
                ? colors.surface
                : "transparent",
              ...Platform.select({
                web: isSelected
                  ? ({ boxShadow: `0px 1px 3px ${colors.shadow}20` } as any)
                  : {},
                default: isSelected
                  ? {
                      shadowColor: colors.shadow,
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.1,
                      shadowRadius: 2,
                      elevation: 2,
                    }
                  : {},
              }),
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: isSelected ? "600" : "400",
                color: isSelected ? colors.text : colors.textSecondary,
                textTransform: "capitalize",
              }}
            >
              {m}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------
export default function ThemeGalleryScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const systemScheme = useColorScheme();

  const [mode, setMode] = useState<ThemeMode>("auto");

  const effectiveScheme: ColorScheme =
    mode === "auto"
      ? systemScheme === "dark"
        ? "dark"
        : "light"
      : mode;

  const overrideValue = useMemo(
    () => ({
      colors: effectiveScheme === "dark" ? darkColors : lightColors,
      isDark: effectiveScheme === "dark",
      colorScheme: effectiveScheme,
      preference: mode,
      setPreference: () => {},
    }),
    [effectiveScheme, mode]
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
      }}
    >
      {/* Sticky header with mode toggle - OUTSIDE the theme override */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 12,
          backgroundColor: colors.background,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text
          style={{
            fontSize: 28,
            fontWeight: "bold",
            color: colors.text,
            marginBottom: 12,
          }}
        >
          Theme Gallery
        </Text>
        <ModeToggle mode={mode} onModeChange={setMode} />
        <Text
          style={{
            fontSize: 12,
            color: colors.textTertiary,
            marginTop: 8,
            textAlign: "center",
          }}
        >
          Previewing: {effectiveScheme} mode
          {mode === "auto" ? " (following system)" : " (forced)"}
        </Text>
      </View>

      {/* Gallery content - INSIDE the theme override */}
      <ThemeContext.Provider value={overrideValue}>
        <ToastContainer>
          <GalleryContent />
        </ToastContainer>
      </ThemeContext.Provider>
    </View>
  );
}
