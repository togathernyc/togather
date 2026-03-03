/**
 * usePcoTeams - Hook for fetching PCO teams for a service type.
 *
 * Loads teams from Planning Center for a specific service type.
 * Used in auto channel configuration to select which teams to sync.
 */
import { useState, useEffect } from "react";
import { useAction } from "convex/react";
import { api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

export function usePcoTeams(
  communityId: Id<"communities"> | null,
  serviceTypeId: string | null
) {
  const { token } = useAuth();
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const getTeams = useAction(
    api.functions.pcoServices.actions.getTeamsForServiceType
  );

  useEffect(() => {
    if (!communityId || !serviceTypeId || !token) {
      setTeams([]);
      return;
    }

    let cancelled = false;

    async function load() {
      if (!communityId || !serviceTypeId || !token) return;

      try {
        setLoading(true);
        setError(null);
        const loadedTeams = await getTeams({ token, communityId, serviceTypeId });
        if (!cancelled) {
          setTeams(loadedTeams);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err : new Error("Failed to load teams")
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
  }, [communityId, serviceTypeId, token, getTeams]);

  return { teams, loading, error };
}
