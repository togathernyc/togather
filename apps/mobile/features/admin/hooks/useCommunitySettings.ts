import { useCallback, useState } from "react";
import { useQuery, useMutation, useAction, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";

/**
 * Hook for fetching and updating community settings
 */
export function useCommunitySettings() {
  const { community, user, refreshUser, token } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [updateError, setUpdateError] = useState<Error | null>(null);

  // Fetch community settings
  const settings = useQuery(
    api.functions.admin.settings.getCommunitySettings,
    community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
        }
      : "skip"
  );

  const isLoading = settings === undefined;

  // Mutation for updating settings
  const updateSettingsMutation = useMutation(
    api.functions.admin.settings.updateCommunitySettings
  );

  // Action for S3 presigned URL
  const getS3PresignedUrl = useAction(api.functions.uploads.getS3PresignedUrl);

  // Update settings function
  const updateSettings = useCallback(
    async (data: {
      name?: string;
      subdomain?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      country?: string;
      primaryColor?: string;
      secondaryColor?: string;
      logo?: string;
      exploreDefaultGroupTypes?: Id<"groupTypes">[];
      exploreDefaultMeetingType?: number;
    }) => {
      if (!community?.id || !user?.id || !token) {
        throw new Error("Not authenticated");
      }

      setIsUpdating(true);
      setUpdateError(null);

      try {
        await updateSettingsMutation({
          token,
          communityId: community.id as Id<"communities">,
          ...data,
        });

        // Refresh user to pick up updated community colors in AuthProvider
        await refreshUser();
      } catch (error) {
        setUpdateError(error as Error);
        throw error;
      } finally {
        setIsUpdating(false);
      }
    },
    [community?.id, user?.id, token, updateSettingsMutation, refreshUser]
  );

  // Upload logo function
  // NOTE: This uses S3 presigned URLs for logo storage
  const uploadLogo = useCallback(
    async (data: { fileName: string; contentType: string }) => {
      if (!community?.id || !user?.id || !token) {
        throw new Error("Not authenticated");
      }

      setIsUploadingLogo(true);

      try {
        // Get S3 presigned URL for community logos
        const result = await getS3PresignedUrl({
          token,
          fileName: data.fileName,
          contentType: data.contentType,
          folder: "uploads" as const, // community logos folder
        });

        return result;
      } finally {
        setIsUploadingLogo(false);
      }
    },
    [community?.id, user?.id, token, getS3PresignedUrl]
  );

  // Refetch is a no-op in Convex (auto-updating), but keep for API compatibility
  const refetch = useCallback(() => {
    // Convex queries auto-update, no manual refetch needed
  }, []);

  return {
    settings,
    isLoading,
    isError: false, // Convex throws on error
    error: null,
    refetch,
    updateSettings,
    isUpdating,
    updateError,
    uploadLogo,
    isUploadingLogo,
  };
}
