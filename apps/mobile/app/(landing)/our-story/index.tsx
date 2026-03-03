import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { AuthGuard } from "@components/guards/AuthGuard";
import { Ionicons } from "@expo/vector-icons";

function OurStoryScreen() {
  const router = useRouter();

  return (
    <AuthGuard>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Our Story</Text>
            <View style={styles.headerRight} />
          </View>

          <View style={styles.content}>
            <Text style={styles.sectionTitle}>About Togather</Text>
            <Text style={styles.description}>
              Togather was created to help communities build stronger connections
              through technology. We believe that meaningful connections happen
              when people come together, and we're here to make that easier.
            </Text>

            <Text style={styles.subsectionTitle}>Our Mission</Text>
            <Text style={styles.description}>
              To empower communities with tools that foster genuine relationships
              and strengthen community bonds.
            </Text>

            <Text style={styles.subsectionTitle}>What We Do</Text>
            <Text style={styles.description}>
              Togather provides a comprehensive platform for communities to manage
              groups, events, messaging, and community engagement - all in one
              place.
            </Text>

            <Text style={styles.subsectionTitle}>Our Vision</Text>
            <Text style={styles.description}>
              A world where every community can easily connect,
              communicate, and grow together.
            </Text>
          </View>
        </ScrollView>
      </View>
    </AuthGuard>
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
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 16,
  },
  subsectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginTop: 24,
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: "#666",
    lineHeight: 24,
    marginBottom: 16,
  },
});

export default OurStoryScreen;
