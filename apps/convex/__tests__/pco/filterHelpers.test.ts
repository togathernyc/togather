/**
 * Tests for PCO Services filter helper functions
 *
 * Unit tests for the position matching and deduplication logic
 * used in the filter-based auto channels.
 */

import { describe, it, expect } from "vitest";
import {
  matchPosition,
  deduplicateByPersonId,
  applyFilters,
  filterPositionsByTeams,
} from "../../functions/pcoServices/filterHelpers";

describe("PCO Services Filter Helpers", () => {
  describe("matchPosition", () => {
    it("returns true when position matches exactly", () => {
      expect(matchPosition("Drums", ["Drums"])).toBe(true);
      expect(matchPosition("Lead Vocals", ["Lead Vocals"])).toBe(true);
    });

    it("returns true when position matches case-insensitively", () => {
      expect(matchPosition("drums", ["Drums"])).toBe(true);
      expect(matchPosition("DRUMS", ["Drums"])).toBe(true);
      expect(matchPosition("Drums", ["drums"])).toBe(true);
    });

    it("returns true when position contains filter term (fuzzy match)", () => {
      expect(matchPosition("Music Director", ["Director"])).toBe(true);
      expect(matchPosition("Worship Director", ["Director"])).toBe(true);
      expect(matchPosition("Technical Director", ["Director"])).toBe(true);
    });

    it("returns true when any filter matches", () => {
      expect(matchPosition("Drums", ["Guitar", "Drums", "Bass"])).toBe(true);
      expect(matchPosition("Lead Guitar", ["Guitar", "Drums"])).toBe(true);
    });

    it("returns false when no filter matches", () => {
      expect(matchPosition("Drums", ["Guitar", "Bass"])).toBe(false);
      expect(matchPosition("Audio Engineer", ["Director"])).toBe(false);
    });

    it("returns false when position is null or undefined", () => {
      expect(matchPosition(null, ["Director"])).toBe(false);
      expect(matchPosition(undefined as unknown as string | null, ["Director"])).toBe(false);
    });

    it("returns false when filters array is empty", () => {
      expect(matchPosition("Drums", [])).toBe(false);
    });

    it("handles whitespace in positions and filters", () => {
      expect(matchPosition("Lead Vocals", ["Lead Vocals"])).toBe(true);
      expect(matchPosition(" Drums ", ["Drums"])).toBe(true);
    });
  });

  // ============================================================================
  // Position Filtering with Context (Option B)
  // ============================================================================
  // Tests for position objects with teamId/serviceTypeId context matching.
  // This enables filtering like "Worship Leader in Manhattan" vs "Worship Leader in Brooklyn".

  describe("matchPosition with context objects", () => {
    it("matches by position name when position object has no teamId", () => {
      const positionFilter = { name: "Worship Leader" };
      // Should behave like fuzzy string match when no context is provided
      expect(matchPosition("Worship Leader", [positionFilter])).toBe(true);
      expect(matchPosition("Lead Worship Leader", [positionFilter])).toBe(true);
      expect(matchPosition("Drums", [positionFilter])).toBe(false);
    });

    it("matches only when teamId matches if position object has teamId", () => {
      const positionFilter = { name: "Worship Leader", teamId: "manhattan-worship" };
      const memberManhattan = { teamId: "manhattan-worship" };
      const memberBrooklyn = { teamId: "brooklyn-worship" };

      // Matching teamId should match
      expect(matchPosition("Worship Leader", [positionFilter], memberManhattan)).toBe(true);
      // Non-matching teamId should not match
      expect(matchPosition("Worship Leader", [positionFilter], memberBrooklyn)).toBe(false);
    });

    it("matches only when serviceTypeId matches if position object has serviceTypeId", () => {
      const positionFilter = { name: "Director", serviceTypeId: "sunday-service" };
      const memberSunday = { serviceTypeId: "sunday-service" };
      const memberWednesday = { serviceTypeId: "wednesday-service" };

      expect(matchPosition("Music Director", [positionFilter], memberSunday)).toBe(true);
      expect(matchPosition("Music Director", [positionFilter], memberWednesday)).toBe(false);
    });

    it("requires both teamId and serviceTypeId to match when both are specified", () => {
      const positionFilter = {
        name: "Worship Leader",
        teamId: "manhattan-worship",
        serviceTypeId: "sunday-service",
      };

      // Both match
      expect(matchPosition("Worship Leader", [positionFilter], {
        teamId: "manhattan-worship",
        serviceTypeId: "sunday-service",
      })).toBe(true);

      // Only teamId matches
      expect(matchPosition("Worship Leader", [positionFilter], {
        teamId: "manhattan-worship",
        serviceTypeId: "wednesday-service",
      })).toBe(false);

      // Only serviceTypeId matches
      expect(matchPosition("Worship Leader", [positionFilter], {
        teamId: "brooklyn-worship",
        serviceTypeId: "sunday-service",
      })).toBe(false);

      // Neither matches
      expect(matchPosition("Worship Leader", [positionFilter], {
        teamId: "brooklyn-worship",
        serviceTypeId: "wednesday-service",
      })).toBe(false);
    });

    it("matches any position object when multiple are provided", () => {
      const positionFilters = [
        { name: "Worship Leader", teamId: "manhattan-worship" },
        { name: "Worship Leader", teamId: "brooklyn-worship" },
      ];

      expect(matchPosition("Worship Leader", positionFilters, {
        teamId: "manhattan-worship",
      })).toBe(true);

      expect(matchPosition("Worship Leader", positionFilters, {
        teamId: "brooklyn-worship",
      })).toBe(true);

      expect(matchPosition("Worship Leader", positionFilters, {
        teamId: "queens-worship",
      })).toBe(false);
    });

    it("handles mixed array of strings and objects (backward compatibility)", () => {
      const positionFilters = [
        "Director", // Plain string - fuzzy match
        { name: "Worship Leader", teamId: "manhattan-worship" }, // Object with context
      ];

      // String filter should match any Director
      expect(matchPosition("Music Director", positionFilters, { teamId: "any-team" })).toBe(true);

      // Object filter should only match Manhattan Worship Leader
      expect(matchPosition("Worship Leader", positionFilters, {
        teamId: "manhattan-worship",
      })).toBe(true);

      expect(matchPosition("Worship Leader", positionFilters, {
        teamId: "brooklyn-worship",
      })).toBe(false);
    });

    it("still uses fuzzy matching for the position name", () => {
      const positionFilter = { name: "Leader", teamId: "worship-team" };

      expect(matchPosition("Worship Leader", [positionFilter], {
        teamId: "worship-team",
      })).toBe(true);

      expect(matchPosition("Team Leader", [positionFilter], {
        teamId: "worship-team",
      })).toBe(true);

      expect(matchPosition("Drums", [positionFilter], {
        teamId: "worship-team",
      })).toBe(false);
    });
  });

  describe("applyFilters with position context", () => {
    const membersWithContext = [
      { teamId: "manhattan-worship", position: "Worship Leader", status: "C", serviceTypeId: "sunday" },
      { teamId: "brooklyn-worship", position: "Worship Leader", status: "C", serviceTypeId: "sunday" },
      { teamId: "manhattan-worship", position: "Drums", status: "C", serviceTypeId: "sunday" },
      { teamId: "brooklyn-worship", position: "Drums", status: "C", serviceTypeId: "sunday" },
      { teamId: "manhattan-production", position: "Audio Engineer", status: "C", serviceTypeId: "sunday" },
    ];

    it("filters by position object with teamId context", () => {
      const result = applyFilters(membersWithContext, {
        positions: [{ name: "Worship Leader", teamId: "manhattan-worship" }],
      });

      expect(result).toHaveLength(1);
      expect(result[0].teamId).toBe("manhattan-worship");
      expect(result[0].position).toBe("Worship Leader");
    });

    it("filters by multiple position objects", () => {
      const result = applyFilters(membersWithContext, {
        positions: [
          { name: "Worship Leader", teamId: "manhattan-worship" },
          { name: "Worship Leader", teamId: "brooklyn-worship" },
        ],
      });

      expect(result).toHaveLength(2);
      expect(result.every((m) => m.position === "Worship Leader")).toBe(true);
    });

    it("combines position context with other filters", () => {
      const membersWithStatus = [
        { teamId: "manhattan-worship", position: "Worship Leader", status: "C" },
        { teamId: "manhattan-worship", position: "Worship Leader", status: "D" },
        { teamId: "brooklyn-worship", position: "Worship Leader", status: "C" },
      ];

      const result = applyFilters(membersWithStatus, {
        positions: [{ name: "Worship Leader", teamId: "manhattan-worship" }],
        statuses: ["C"],
      });

      expect(result).toHaveLength(1);
      expect(result[0].teamId).toBe("manhattan-worship");
      expect(result[0].status).toBe("C");
    });

    it("backward compatible: plain strings still work", () => {
      const result = applyFilters(membersWithContext, {
        positions: ["Worship Leader"],
      });

      // Should match all Worship Leaders regardless of team
      expect(result).toHaveLength(2);
      expect(result.every((m) => m.position === "Worship Leader")).toBe(true);
    });

    it("handles mix of string and object positions", () => {
      const result = applyFilters(membersWithContext, {
        positions: [
          "Audio Engineer", // String - matches any team
          { name: "Worship Leader", teamId: "manhattan-worship" }, // Object - only Manhattan
        ],
      });

      expect(result).toHaveLength(2);
      expect(result.find((m) => m.position === "Audio Engineer")).toBeDefined();
      expect(result.find((m) => m.position === "Worship Leader" && m.teamId === "manhattan-worship")).toBeDefined();
      // Brooklyn Worship Leader should NOT be included
      expect(result.find((m) => m.position === "Worship Leader" && m.teamId === "brooklyn-worship")).toBeUndefined();
    });
  });

  describe("deduplicateByPersonId", () => {
    it("removes duplicate entries by pcoPersonId", () => {
      const members = [
        {
          pcoPersonId: "person-1",
          name: "John Doe",
          position: "Drums",
          teamId: "team-1",
          teamName: "Band",
          status: "C",
          scheduledRemovalAt: 1000,
        },
        {
          pcoPersonId: "person-1",
          name: "John Doe",
          position: "Vocals",
          teamId: "team-2",
          teamName: "Vocals",
          status: "C",
          scheduledRemovalAt: 2000,
        },
        {
          pcoPersonId: "person-2",
          name: "Jane Smith",
          position: "Guitar",
          teamId: "team-1",
          teamName: "Band",
          status: "C",
          scheduledRemovalAt: 1500,
        },
      ];

      const result = deduplicateByPersonId(members);

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.pcoPersonId)).toEqual(["person-1", "person-2"]);
    });

    it("keeps the entry with the latest scheduledRemovalAt", () => {
      const members = [
        {
          pcoPersonId: "person-1",
          name: "John Doe",
          position: "Drums",
          teamId: "team-1",
          teamName: "Band",
          status: "C",
          scheduledRemovalAt: 1000,
        },
        {
          pcoPersonId: "person-1",
          name: "John Doe",
          position: "Vocals",
          teamId: "team-2",
          teamName: "Vocals",
          status: "C",
          scheduledRemovalAt: 3000,
        },
        {
          pcoPersonId: "person-1",
          name: "John Doe",
          position: "Bass",
          teamId: "team-3",
          teamName: "Bass",
          status: "C",
          scheduledRemovalAt: 2000,
        },
      ];

      const result = deduplicateByPersonId(members);

      expect(result).toHaveLength(1);
      expect(result[0].scheduledRemovalAt).toBe(3000);
      expect(result[0].position).toBe("Vocals");
    });

    it("handles empty array", () => {
      const result = deduplicateByPersonId([]);
      expect(result).toEqual([]);
    });

    it("handles single entry", () => {
      const members = [
        {
          pcoPersonId: "person-1",
          name: "John Doe",
          position: "Drums",
          teamId: "team-1",
          teamName: "Band",
          status: "C",
          scheduledRemovalAt: 1000,
        },
      ];

      const result = deduplicateByPersonId(members);

      expect(result).toHaveLength(1);
      expect(result[0].pcoPersonId).toBe("person-1");
    });

    it("preserves all fields of the kept entry", () => {
      const members = [
        {
          pcoPersonId: "person-1",
          name: "John Doe",
          position: "Drums",
          teamId: "team-1",
          teamName: "Band",
          status: "C",
          scheduledRemovalAt: 1000,
          serviceTypeId: "st-1",
          serviceTypeName: "Sunday Service",
          planId: "plan-1",
          planDate: 1234567890,
        },
      ];

      const result = deduplicateByPersonId(members);

      expect(result[0]).toEqual(members[0]);
    });

    it("handles entries without pcoPersonId by treating them as unique", () => {
      const members = [
        {
          pcoPersonId: null,
          name: "Unknown 1",
          position: "Drums",
          teamId: "team-1",
          teamName: "Band",
          status: "C",
          scheduledRemovalAt: 1000,
        },
        {
          pcoPersonId: null,
          name: "Unknown 2",
          position: "Vocals",
          teamId: "team-2",
          teamName: "Vocals",
          status: "C",
          scheduledRemovalAt: 2000,
        },
      ];

      const result = deduplicateByPersonId(members);

      // Null pcoPersonIds should all be kept as they can't be deduplicated
      expect(result).toHaveLength(2);
    });
  });

  describe("applyFilters", () => {
    const members = [
      { teamId: "team-1", position: "Drums", status: "C" },
      { teamId: "team-1", position: "Guitar", status: "C" },
      { teamId: "team-2", position: "Lead Vocals", status: "C" },
      { teamId: "team-2", position: "Backup Vocals", status: "D" },
      { teamId: "team-3", position: "Kids Leader", status: "C" },
    ];

    it("filters by team IDs", () => {
      const result = applyFilters(members, { teamIds: ["team-1"] });
      expect(result).toHaveLength(2);
      expect(result.every((m) => m.teamId === "team-1")).toBe(true);
    });

    it("filters by multiple team IDs", () => {
      const result = applyFilters(members, { teamIds: ["team-1", "team-2"] });
      expect(result).toHaveLength(3); // 2 from team-1, 1 from team-2 (excludes declined)
      expect(result.every((m) => ["team-1", "team-2"].includes(m.teamId!))).toBe(true);
    });

    it("excludes declined status by default", () => {
      const result = applyFilters(members, {});
      expect(result).toHaveLength(4); // All except the declined one
      expect(result.every((m) => m.status !== "D")).toBe(true);
    });

    it("filters by position with fuzzy matching", () => {
      const result = applyFilters(members, { positions: ["Vocals"] });
      // Should match "Lead Vocals" but exclude "Backup Vocals" (declined)
      expect(result).toHaveLength(1);
      expect(result[0].position).toBe("Lead Vocals");
    });

    it("returns all members when no team filter is applied", () => {
      const result = applyFilters(members, { statuses: ["C", "D"] });
      expect(result).toHaveLength(5);
    });
  });

  describe("filterPositionsByTeams", () => {
    // Members with positions on different teams - simulating PCO data
    const membersFromPco = [
      { position: "Drums", teamId: "band-team", teamName: "Band" },
      { position: "Guitar", teamId: "band-team", teamName: "Band" },
      { position: "Lead Vocals", teamId: "vocals-team", teamName: "Vocals" },
      { position: "Kids Leader", teamId: "kids-team", teamName: "Kids" },
      { position: "Kids Helper", teamId: "kids-team", teamName: "Kids" },
      { position: "Audio Engineer", teamId: "production-team", teamName: "Production" },
      { position: "Drums", teamId: "band-team", teamName: "Band" }, // Duplicate position
    ];

    it("filters positions to only those belonging to selected teams", () => {
      const result = filterPositionsByTeams(membersFromPco, ["band-team"]);

      expect(result).toHaveLength(2);
      expect(result.map((p) => p.name)).toContain("Drums");
      expect(result.map((p) => p.name)).toContain("Guitar");
      expect(result.map((p) => p.name)).not.toContain("Kids Leader");
    });

    it("returns positions from multiple selected teams", () => {
      const result = filterPositionsByTeams(membersFromPco, ["band-team", "kids-team"]);

      expect(result).toHaveLength(4);
      expect(result.map((p) => p.name)).toContain("Drums");
      expect(result.map((p) => p.name)).toContain("Guitar");
      expect(result.map((p) => p.name)).toContain("Kids Leader");
      expect(result.map((p) => p.name)).toContain("Kids Helper");
      expect(result.map((p) => p.name)).not.toContain("Audio Engineer");
    });

    it("returns all positions when no teams are selected", () => {
      const result = filterPositionsByTeams(membersFromPco, []);

      expect(result).toHaveLength(6); // 6 unique positions across all teams
      expect(result.map((p) => p.name)).toContain("Drums");
      expect(result.map((p) => p.name)).toContain("Guitar");
      expect(result.map((p) => p.name)).toContain("Lead Vocals");
      expect(result.map((p) => p.name)).toContain("Kids Leader");
      expect(result.map((p) => p.name)).toContain("Kids Helper");
      expect(result.map((p) => p.name)).toContain("Audio Engineer");
    });

    it("returns all positions when teamIds is undefined", () => {
      const result = filterPositionsByTeams(membersFromPco, undefined);

      expect(result).toHaveLength(6); // 6 unique positions across all teams
    });

    it("deduplicates positions and aggregates counts", () => {
      const result = filterPositionsByTeams(membersFromPco, []);

      const drums = result.find((p) => p.name === "Drums");
      expect(drums).toBeDefined();
      expect(drums?.count).toBe(2); // "Drums" appears twice
    });

    it("returns empty array when no members have positions", () => {
      const membersWithoutPositions = [
        { position: null, teamId: "team-1", teamName: "Team 1" },
        { position: null, teamId: "team-2", teamName: "Team 2" },
      ];

      const result = filterPositionsByTeams(membersWithoutPositions, []);
      expect(result).toHaveLength(0);
    });

    it("excludes members with null teamId when filtering by teams", () => {
      const membersWithNullTeam = [
        { position: "Drums", teamId: "band-team", teamName: "Band" },
        { position: "Orphan Position", teamId: null, teamName: null },
      ];

      const result = filterPositionsByTeams(membersWithNullTeam, ["band-team"]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Drums");
    });

    it("sorts positions by count (most common first)", () => {
      const membersWithVariedCounts = [
        { position: "Guitar", teamId: "team-1", teamName: "Team 1" },
        { position: "Drums", teamId: "team-1", teamName: "Team 1" },
        { position: "Drums", teamId: "team-1", teamName: "Team 1" },
        { position: "Drums", teamId: "team-1", teamName: "Team 1" },
        { position: "Bass", teamId: "team-1", teamName: "Team 1" },
        { position: "Bass", teamId: "team-1", teamName: "Team 1" },
      ];

      const result = filterPositionsByTeams(membersWithVariedCounts, []);

      expect(result[0].name).toBe("Drums");
      expect(result[0].count).toBe(3);
      expect(result[1].name).toBe("Bass");
      expect(result[1].count).toBe(2);
      expect(result[2].name).toBe("Guitar");
      expect(result[2].count).toBe(1);
    });
  });
});
