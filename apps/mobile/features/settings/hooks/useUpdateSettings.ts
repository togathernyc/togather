import { useState } from "react";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import { SettingsFormData } from "../types";
import type { Id } from "@services/api/convex";

/**
 * Hook to handle settings updates
 *
 * Transforms snake_case data from forms to camelCase for Convex
 */
export function useUpdateSettings() {
  const { user, refreshUser } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;
  const updateMutation = useAuthenticatedMutation(api.functions.users.update);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updateSettings = async (
    data: SettingsFormData,
    options?: { onSuccess?: () => void }
  ) => {
    if (!userId) {
      setError(new Error("User not authenticated"));
      return;
    }

    setIsUpdating(true);
    setError(null);

    try {
      // Transform snake_case to camelCase for Convex
      await updateMutation({
        firstName: data.first_name,
        lastName: data.last_name,
      });

      // Refresh user data in auth context
      await refreshUser();
      options?.onSuccess?.();
    } catch (err: any) {
      setError(err);
      throw err;
    } finally {
      setIsUpdating(false);
    }
  };

  return {
    updateSettings,
    isUpdating,
    error,
  };
}
