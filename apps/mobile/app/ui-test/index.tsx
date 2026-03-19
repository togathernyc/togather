import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import {
  Button,
  Card,
  Modal,
  Input,
  Avatar,
  FormInput,
  Badge,
  Toast,
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
} from "@components/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTheme } from "@hooks/useTheme";

const testSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
});

function UITestScreen() {
  const { colors } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [switchValue, setSwitchValue] = useState(false);
  const [progress, setProgress] = useState(0.3);
  const [selectedValue, setSelectedValue] = useState<string | number>("");
  const [searchValue, setSearchValue] = useState("");
  const [dateValue, setDateValue] = useState<Date | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(testSchema),
    defaultValues: {
      name: "",
      email: "",
    },
  });

  const selectOptions = [
    { label: "Option 1", value: "1" },
    { label: "Option 2", value: "2" },
    { label: "Option 3", value: "3" },
    { label: "Option 4", value: "4" },
  ];

  const onSubmit = (data: any) => {
    Alert.alert("Form Submitted", JSON.stringify(data));
  };

  const sectionStyle = [
    styles.section,
    {
      backgroundColor: colors.surface,
      ...Platform.select({
        web: {
          boxShadow: `0px 2px 8px rgba(0, 0, 0, 0.1)`,
        },
        default: {
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          elevation: 3,
        },
      }),
    },
  ];

  return (
    <ToastContainer>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
        contentContainerStyle={styles.content}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>UI Components Test</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Testing all UI components in browser
          </Text>
        </View>

        {/* Button */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Button</Text>
          <View style={styles.buttonRow}>
            <Button
              onPress={() => Alert.alert("Primary clicked")}
              variant="primary"
            >
              Primary
            </Button>
            <Button
              onPress={() => Alert.alert("Secondary clicked")}
              variant="secondary"
            >
              Secondary
            </Button>
            <Button
              onPress={() => Alert.alert("Danger clicked")}
              variant="danger"
            >
              Danger
            </Button>
          </View>
          <Button onPress={() => Alert.alert("Loading clicked")} loading>
            Loading
          </Button>
          <Button onPress={() => {}} disabled>
            Disabled
          </Button>
        </View>

        {/* Card */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Card</Text>
          <Card style={styles.card}>
            <Text style={[styles.cardText, { color: colors.text }]}>This is a card component</Text>
          </Card>
          <Card onPress={() => Alert.alert("Card pressed")} style={styles.card}>
            <Text style={[styles.cardText, { color: colors.text }]}>Clickable card</Text>
          </Card>
        </View>

        {/* Avatar */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Avatar</Text>
          <View style={styles.avatarRow}>
            <Avatar
              name="Alice"
              imageUrl="https://via.placeholder.com/100"
              size={64}
            />
          </View>
        </View>

        {/* Badge */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Badge</Text>
          <View style={styles.badgeRow}>
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
        </View>

        {/* Input */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Input</Text>
          <Input
            label="Regular Input"
            placeholder="Enter text"
            value={searchValue}
            onChangeText={setSearchValue}
          />
          <Input
            label="Password Input"
            placeholder="Enter password"
            value=""
            onChangeText={() => {}}
            secureTextEntry
            required
          />
          <Input
            label="Error Input"
            placeholder="Enter email"
            value=""
            onChangeText={() => {}}
            error="This field is required"
            required
          />
        </View>

        {/* FormInput */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>FormInput (with validation)</Text>
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
            style={{ marginTop: 16 }}
          >
            Submit Form
          </Button>
        </View>

        {/* Select */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Select/Dropdown</Text>
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
        </View>

        {/* SearchBar */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>SearchBar</Text>
          <SearchBar
            placeholder="Search..."
            value={searchValue}
            onChangeText={setSearchValue}
            onSearch={(text) => Alert.alert("Search", text)}
          />
        </View>

        {/* Switch */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Switch/Toggle</Text>
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
        </View>

        {/* ProgressBar */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>ProgressBar</Text>
          <ProgressBar progress={progress} showPercentage />
          <View style={styles.progressControls}>
            <Button
              onPress={() => setProgress(Math.max(0, progress - 0.1))}
              variant="secondary"
              style={{ flex: 1, marginRight: 8 }}
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
        </View>

        {/* DatePicker */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>DatePicker</Text>
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
        </View>

        {/* Modal */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Modal</Text>
          <Button onPress={() => setModalVisible(true)} variant="primary">
            Open Modal
          </Button>
          <Modal
            visible={modalVisible}
            onClose={() => setModalVisible(false)}
            title="Test Modal"
          >
            <Text style={[styles.modalText, { color: colors.text }]}>This is a modal component</Text>
            <Text style={[styles.modalText, { color: colors.text }]}>
              You can close it by clicking the X or outside
            </Text>
            <Button
              onPress={() => setModalVisible(false)}
              variant="primary"
              style={{ marginTop: 16 }}
            >
              Close Modal
            </Button>
          </Modal>
        </View>

        {/* Toast */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Toast</Text>
          <View style={styles.buttonRow}>
            <Button
              onPress={() => ToastManager.success("Success message!")}
              variant="primary"
              style={{ flex: 1, marginRight: 8, backgroundColor: colors.success }}
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
          <View style={styles.buttonRow}>
            <Button
              onPress={() => ToastManager.warning("Warning message!")}
              variant="secondary"
              style={{ flex: 1, marginRight: 8, backgroundColor: colors.warning }}
            >
              Warning
            </Button>
            <Button
              onPress={() => ToastManager.info("Info message!")}
              variant="primary"
              style={{ flex: 1, backgroundColor: colors.link }}
            >
              Info
            </Button>
          </View>
        </View>

        {/* Skeleton */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Skeleton/Loading</Text>
          <Skeleton width={200} height={20} style={{ marginBottom: 16 }} />
          <SkeletonText lines={3} style={{ marginBottom: 16 }} />
          <SkeletonAvatar size={64} style={{ marginBottom: 16 }} />
          <SkeletonCard />
        </View>

        {/* EmptyState */}
        <View style={sectionStyle}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>EmptyState</Text>
          <EmptyState
            icon="document-outline"
            title="No items found"
            message="Try adjusting your search or filters"
            actionLabel="Refresh"
            onAction={() => Alert.alert("Refresh clicked")}
          />
        </View>
      </ScrollView>
    </ToastContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 32,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
  },
  section: {
    marginBottom: 32,
    padding: 20,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  card: {
    padding: 16,
    marginBottom: 12,
  },
  cardText: {
    fontSize: 16,
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  progressControls: {
    flexDirection: "row",
    marginTop: 16,
  },
  modalText: {
    fontSize: 16,
    marginBottom: 8,
    lineHeight: 24,
  },
});

export default UITestScreen;
