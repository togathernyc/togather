// useSignUp hook - handles sign up logic

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "expo-router";
import { formatAuthError } from "../utils";
import { communityStorage } from "../utils/communityStorage";
import { SignUpData } from "../types";
import { useAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

interface UseSignUpOptions {
  phone?: string;
  countryCode?: string;
  otp?: string;
}

export function useSignUp(options: UseSignUpOptions = {}) {
  const router = useRouter();
  const [formData, setFormData] = useState<Partial<SignUpData>>({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    email: "",
    password: "",
    zip_code: "",
    location: "",
    country: "",
  });
  const [selectedLocation, setSelectedLocation] = useState<any>(null);
  const [error, setError] = useState("");
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Phone auth info from params (for new users from phone-first flow)
  const phoneInfo = {
    phone: options.phone || "",
    countryCode: options.countryCode || "US",
    otp: options.otp || "",
  };

  // Convex signup action
  const signupAction = useAction(api.functions.auth.registration.signup);

  useEffect(() => {
    communityStorage.getCommunityId().then((id) => {
      if (!id) {
        router.replace("/(auth)/signin");
      } else {
        setCommunityId(id);
      }
    });
  }, [router]);

  const handleInputChange = (field: keyof SignUpData, value: string) => {
    if (
      field === "date_of_birth" ||
      field === "email" ||
      field === "password"
    ) {
      // Prevent spaces in these fields
      if (/\s/.test(value)) return;
    }
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = useCallback(async () => {
    setError("");

    if (!formData.first_name) {
      setError("First name is required");
      return;
    }
    if (!formData.last_name) {
      setError("Last name is required");
      return;
    }
    if (!formData.date_of_birth) {
      setError("Date of birth is required");
      return;
    }
    if (!formData.email) {
      setError("Email is required");
      return;
    }
    if (!formData.password) {
      setError("Password is required");
      return;
    }
    if (!formData.country) {
      setError("Country is required");
      return;
    }
    if (!selectedLocation) {
      setError("Location is required");
      return;
    }

    // Format date of birth (assuming MM/DD/YYYY format)
    let formattedDate = formData.date_of_birth!;
    if (formattedDate.includes("/")) {
      const [month, day, year] = formattedDate.split("/");
      formattedDate = `${year}-${month.padStart(2, "0")}-${day.padStart(
        2,
        "0"
      )}`;
    }

    setIsLoading(true);
    try {
      // Call Convex signup action
      // Note: communityId needs to be a Convex ID
      await signupAction({
        firstName: formData.first_name!,
        lastName: formData.last_name!,
        email: formData.email!,
        password: formData.password!,
        dateOfBirth: formattedDate,
        communityId: communityId as Id<"communities">,
        location: selectedLocation.id,
        country: formData.country!,
        phone: phoneInfo.phone || undefined,
        countryCode: phoneInfo.countryCode || undefined,
        otp: phoneInfo.otp || undefined,
      });

      // If user came from phone-first flow, they can go directly to signin
      // The backend will have verified their phone during registration
      router.replace("/(auth)/signin");
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setIsLoading(false);
    }
  }, [formData, selectedLocation, communityId, phoneInfo, signupAction, router]);

  return {
    formData,
    selectedLocation,
    setSelectedLocation,
    error,
    setError,
    communityId,
    handleInputChange,
    handleSubmit,
    isLoading,
  };
}
