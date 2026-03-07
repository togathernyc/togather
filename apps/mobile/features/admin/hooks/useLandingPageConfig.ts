import { useCallback, useState } from "react";
import { useQuery, useMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";

/**
 * Hook for fetching and updating community landing page configuration
 */
export function useLandingPageConfig() {
  const { community, token } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch landing page config
  const result = useQuery(
    api.functions.communityLandingPage.getConfig,
    community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
        }
      : "skip"
  );

  const isLoading = result === undefined;
  const config = result?.config;
  const communitySlug = result?.community?.slug;
  const followupCustomFields = result?.followupCustomFields ?? [];

  // Save mutation
  const saveConfigMutation = useMutation(
    api.functions.communityLandingPage.saveConfig
  );

  const saveConfig = useCallback(
    async (data: {
      isEnabled: boolean;
      title?: string;
      description?: string;
      submitButtonText?: string;
      successMessage?: string;
      generateNoteSummary?: boolean;
      formFields: Array<{
        slot?: string;
        label: string;
        type: string;
        options?: string[];
        required: boolean;
        order: number;
        includeInNotes?: boolean;
      }>;
      automationRules: Array<{
        id: string;
        name: string;
        isEnabled: boolean;
        condition: {
          field: string;
          operator: string;
          value?: string;
        };
        action: {
          type: string;
          assigneePhone?: string;
          assigneeUserId?: Id<"users">;
        };
      }>;
    }) => {
      if (!community?.id || !token) {
        throw new Error("Not authenticated");
      }

      setIsSaving(true);
      setSaveError(null);

      try {
        await saveConfigMutation({
          token,
          communityId: community.id as Id<"communities">,
          ...data,
        });
      } catch (error: any) {
        setSaveError(error.message || "Failed to save");
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [community?.id, token, saveConfigMutation]
  );

  return {
    config,
    communitySlug,
    followupCustomFields,
    isLoading,
    isSaving,
    saveError,
    saveConfig,
  };
}
