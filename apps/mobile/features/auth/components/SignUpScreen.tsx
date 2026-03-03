// SignUpScreen component - main sign up screen

import React, { useState, useEffect } from "react";
import { ScrollView, StyleSheet, View, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthGuard } from "@components/guards/AuthGuard";
import { useSignUp } from "../hooks/useSignUp";
import { SignUpForm } from "./SignUpForm";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

export function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    phone?: string;
    countryCode?: string;
    otp?: string;
  }>();
  const signUp = useSignUp({
    phone: params.phone,
    countryCode: params.countryCode,
    otp: params.otp,
  });

  // NOTE: LocationCategory model was deleted from Django backend.
  // This endpoint returns an empty array for backwards compatibility.
  // Mobile app should be updated to remove location selection from sign-up flow.
  const locations = useQuery(
    api.functions.resources.getCommunityLocations,
    signUp.communityId ? { communityId: signUp.communityId as Id<"communities"> } : "skip"
  ) ?? [];

  // Set document title on web to prevent "signup/index" from showing
  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.title = "Create Account";
    }
  }, []);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(auth)/signin");
    }
  };

  return (
    <AuthGuard>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.content}>
          <SignUpForm
            formData={signUp.formData}
            selectedLocation={signUp.selectedLocation}
            locations={locations}
            error={signUp.error}
            isLoading={signUp.isLoading}
            communityId={signUp.communityId}
            onInputChange={signUp.handleInputChange}
            onLocationChange={signUp.setSelectedLocation}
            onSubmit={signUp.handleSubmit}
            onBack={handleBack}
            onSignIn={() => router.push("/(auth)/signin")}
          />
        </View>
      </ScrollView>
    </AuthGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#fff",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },
});
