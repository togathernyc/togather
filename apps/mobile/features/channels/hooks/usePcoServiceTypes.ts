/**
 * usePcoServiceTypes - Hook for fetching PCO service types.
 *
 * Loads service types from Planning Center for a community.
 * Used in auto channel configuration to select which service type to sync.
 */
import { useState, useEffect } from "react";
import { useAction } from "convex/react";
import { api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

export function usePcoServiceTypes(communityId: Id<"communities"> | null) {
  const { token } = useAuth();
  const [serviceTypes, setServiceTypes] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const getServiceTypes = useAction(
    api.functions.pcoServices.actions.getServiceTypes
  );

  useEffect(() => {
    if (!communityId || !token) {
      setServiceTypes([]);
      return;
    }

    let cancelled = false;

    async function load() {
      if (!communityId || !token) return;

      try {
        setLoading(true);
        setError(null);
        const types = await getServiceTypes({ token, communityId });
        if (!cancelled) {
          setServiceTypes(types);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err
              : new Error("Failed to load service types")
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [communityId, token, getServiceTypes]);

  return { serviceTypes, loading, error };
}
