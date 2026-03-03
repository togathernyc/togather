import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

function SupportScreen() {
  const router = useRouter();

  const handleEmailPress = () => {
    Linking.openURL("mailto:togather@supa.media");
  };

  const handleWebsitePress = () => {
    Linking.openURL("https://gettogather.co");
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Support</Text>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.content}>
          <Text style={styles.sectionTitle}>Get Help</Text>
          <Text style={styles.description}>
            We're here to help! Reach out to us through any of the following
            channels.
          </Text>

          <TouchableOpacity
            style={styles.contactCard}
            onPress={handleEmailPress}
          >
            <Ionicons name="mail" size={24} color="#007AFF" />
            <View style={styles.contactInfo}>
              <Text style={styles.contactTitle}>Email Support</Text>
              <Text style={styles.contactDetails}>togather@supa.media</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.contactCard}
            onPress={handleWebsitePress}
          >
            <Ionicons name="globe" size={24} color="#007AFF" />
            <View style={styles.contactInfo}>
              <Text style={styles.contactTitle}>Visit Our Website</Text>
              <Text style={styles.contactDetails}>gettogather.co</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          <View style={styles.faqSection}>
            <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
            <View style={styles.faqItem}>
              <Text style={styles.faqQuestion}>How do I sign in?</Text>
              <Text style={styles.faqAnswer}>
                Simply enter your phone number and we'll send you a one-time
                verification code via SMS. No password needed!
              </Text>
            </View>
            <View style={styles.faqItem}>
              <Text style={styles.faqQuestion}>How do I join a group?</Text>
              <Text style={styles.faqAnswer}>
                Browse available groups and tap "Join" on any group you'd like
                to be part of.
              </Text>
            </View>
            <View style={styles.faqItem}>
              <Text style={styles.faqQuestion}>
                Can I join multiple communities?
              </Text>
              <Text style={styles.faqAnswer}>
                Yes! Togather supports being a member of multiple communities.
                You can easily switch between them from your profile.
              </Text>
            </View>
            <View style={styles.faqItem}>
              <Text style={styles.faqQuestion}>
                Why is a phone number required?
              </Text>
              <Text style={styles.faqAnswer}>
                As a community app focused on helping people meet in person, we
                prioritize safety by verifying that all users are real people.
                Phone number verification helps us maintain a trusted
                environment for everyone.
              </Text>
            </View>
            <View style={styles.faqItem}>
              <Text style={styles.faqQuestion}>
                Can I use Togather on multiple devices?
              </Text>
              <Text style={styles.faqAnswer}>
                Yes! Your account syncs across all your devices.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
  },
  headerRight: {
    width: 40,
  },
  content: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: "#666",
    lineHeight: 24,
    marginBottom: 24,
  },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  contactInfo: {
    flex: 1,
    marginLeft: 12,
  },
  contactTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  contactDetails: {
    fontSize: 14,
    color: "#666",
  },
  faqSection: {
    marginTop: 32,
  },
  faqItem: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  faqQuestion: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  faqAnswer: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
});

export default SupportScreen;
