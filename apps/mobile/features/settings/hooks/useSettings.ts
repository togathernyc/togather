import { useState } from "react";
import { useAuth } from "@providers/AuthProvider";

/**
 * Hook to manage settings state
 */
export function useSettings() {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState(user?.first_name || "");
  const [lastName, setLastName] = useState(user?.last_name || "");
  const [isEditing, setIsEditing] = useState(false);

  const resetForm = () => {
    setFirstName(user?.first_name || "");
    setLastName(user?.last_name || "");
    setIsEditing(false);
  };

  return {
    firstName,
    setFirstName,
    lastName,
    setLastName,
    isEditing,
    setIsEditing,
    resetForm,
    user,
  };
}
