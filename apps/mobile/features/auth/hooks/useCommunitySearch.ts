// useCommunitySearch hook - handles community search logic

import { useState, useCallback } from "react";
import { CommunitySearchResult } from "../types";
import { useConvex, api } from "@services/api/convex";

export function useCommunitySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommunitySearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const convex = useConvex();

  const handleSearch = useCallback(async (searchQuery: string) => {
    setQuery(searchQuery);

    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      // Call Convex query
      const response = await convex.query(api.functions.resources.communitySearch, {
        query: searchQuery
      });

      console.log(
        "Community search response:",
        JSON.stringify(response, null, 2)
      );

      // Convex returns: { data: [...] }
      const searchResults: CommunitySearchResult[] = response.data || [];
      console.log("Found communities:", searchResults.length);

      console.log("Setting results:", searchResults);
      setResults(searchResults);
    } catch (err: any) {
      console.error("Community search error:", err);
      console.error("Error message:", err.message);

      // Check if backend is unreachable
      if (
        err.message?.includes("Network Error") ||
        err.message?.includes("Network request failed") ||
        err.message?.includes("Failed to fetch")
      ) {
        console.error("Convex backend appears to be unavailable");
      }

      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [convex]);

  return {
    query,
    results,
    searching,
    handleSearch,
  };
}
