import React, { useState, useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { EventDetails } from "@features/leader-tools/components/EventDetails";
import { useQuery, api, Id } from "@services/api/convex";
import AsyncStorage from "@react-native-async-storage/async-storage";

function EventDetailsPage() {
  const { group_id, event_id: eventIdParam } = useLocalSearchParams<{
    group_id: string;
    event_id: string;
  }>();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  // Load auth token from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem('auth_token').then(setToken);
  }, []);

  // Fetch group details using Convex to check if user is leader
  const group = useQuery(
    api.functions.groups.queries.getByIdWithRole,
    group_id && token ? { groupId: group_id as Id<"groups">, token } : "skip"
  );

  // Check if current user is a leader based on userRole from Convex response
  const isLeader = React.useMemo(() => {
    if (!group) return false;
    return group.userRole === "leader" || group.userRole === "admin";
  }, [group]);

  // Parse the event identifier
  // Format: "id-{uuid}|{encoded-date}" for events with ID, "date-{encoded-date}" for events without ID
  // Using "|" as separator since encoded dates may contain dashes
  let eventDate: string | null = null;
  let meetingId: string | null = null;

  if (eventIdParam) {
    console.log("EventDetailsPage: Parsing event_id:", eventIdParam);
    if (eventIdParam.startsWith("id-")) {
      // Extract UUID and date from "id-{uuid}|{encoded-date}" format
      const afterPrefix = eventIdParam.replace("id-", "");
      const separatorIndex = afterPrefix.indexOf("|");
      if (separatorIndex > 0) {
        const idStr = afterPrefix.substring(0, separatorIndex);
        meetingId = idStr; // Keep as string (UUID)
        const encodedDate = afterPrefix.substring(separatorIndex + 1);
        try {
          eventDate = decodeURIComponent(encodedDate);
        } catch (e) {
          // If decoding fails, try using the date as-is (might already be decoded)
          eventDate = encodedDate;
        }
        console.log("EventDetailsPage: Extracted from id- format:", {
          meetingId,
          eventDate,
        });
      }
    } else if (eventIdParam.startsWith("date-")) {
      // Extract date from "date-{encoded-date}" format
      const encodedDate = eventIdParam.substring(5); // Remove "date-" prefix (5 characters)
      try {
        // Try to decode if it's URL encoded
        eventDate = decodeURIComponent(encodedDate);
        // If decoding didn't change anything, it might not have been encoded
        if (eventDate === encodedDate && encodedDate.includes("%")) {
          // If it contains % but decode didn't work, try again
          eventDate = decodeURIComponent(encodedDate);
        }
      } catch (e) {
        // If decoding fails, use the date as-is (might already be decoded)
        eventDate = encodedDate;
      }
      console.log("EventDetailsPage: Extracted from date- format:", {
        eventIdParam,
        encodedDate,
        eventDate,
        decoded: eventDate !== encodedDate,
      });
    } else {
      // If it doesn't start with "id-" or "date-", it might be an old format
      // Try to parse it as a direct date string
      console.warn(
        "EventDetailsPage: Unexpected event_id format:",
        eventIdParam
      );
      // Check if it looks like a date string
      if (
        eventIdParam.includes("T") &&
        (eventIdParam.includes("Z") || eventIdParam.includes("+"))
      ) {
        eventDate = eventIdParam;
        console.log(
          "EventDetailsPage: Using event_id as date directly:",
          eventDate
        );
      }
    }
  } else {
    console.warn("EventDetailsPage: eventIdParam is missing");
  }

  // Handle back navigation
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(tabs)/search?view=events`);
    }
  };

  // Handle group chat navigation - navigate to inbox with group ID
  const handleGroupChat = () => {
    if (group_id) {
      const groupName = group?.name || "";
      // Navigate to inbox with query params to create/find chat room
      const inboxUrl = `/inbox?dp_id=${group_id}&dp_name=${encodeURIComponent(
        groupName
      )}`;
      console.log("EventDetailsPage: Navigating to inbox:", inboxUrl);
      router.push(inboxUrl);
    } else {
      console.warn(
        "EventDetailsPage: group_id is missing, cannot navigate to inbox"
      );
    }
  };

  // Validate eventDate and meetingId before proceeding
  if (!eventDate) {
    console.error(
      "EventDetailsPage: eventDate is missing or could not be parsed from event_id:",
      eventIdParam
    );
    // Redirect back to events list if we can't parse the event
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/(tabs)/search?view=events`);
    }
    return null;
  }

  if (!meetingId) {
    console.error(
      "EventDetailsPage: meetingId is missing - all events must have a meeting ID"
    );
    // Redirect back to events list if meetingId is missing
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/(tabs)/search?view=events`);
    }
    return null;
  }

  // Clean eventDate if it still has a prefix (defensive check)
  let cleanEventDate = eventDate;
  if (eventDate.startsWith("date-")) {
    console.warn(
      "EventDetailsPage: eventDate still has 'date-' prefix, removing it:",
      eventDate
    );
    cleanEventDate = eventDate.substring(5); // Remove "date-" prefix
  } else if (eventDate.startsWith("id-")) {
    console.warn(
      "EventDetailsPage: eventDate has 'id-' prefix, extracting date:",
      eventDate
    );
    const afterPrefix = eventDate.replace("id-", "");
    const separatorIndex = afterPrefix.indexOf("|");
    if (separatorIndex > 0) {
      cleanEventDate = afterPrefix.substring(separatorIndex + 1);
    }
  }

  // Validate that the date string is valid
  const testDate = new Date(cleanEventDate);
  if (isNaN(testDate.getTime())) {
    console.error("EventDetailsPage: Invalid eventDate after cleaning:", {
      original: eventDate,
      cleaned: cleanEventDate,
    });
    // Redirect back to events list if date is invalid
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/(tabs)/search?view=events`);
    }
    return null;
  }

  // Use the cleaned date
  eventDate = cleanEventDate;

  return (
    <UserRoute>
      <EventDetails
        groupId={group_id || ""}
        eventDate={eventDate}
        meetingId={meetingId!}
        isLeader={isLeader}
        onBack={handleBack}
        onGroupChat={handleGroupChat}
      />
    </UserRoute>
  );
}

export default EventDetailsPage;
