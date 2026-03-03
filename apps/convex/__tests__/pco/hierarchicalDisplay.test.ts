/**
 * Tests for PCO Services hierarchical display format
 *
 * Tests that teams and positions include their parent context
 * for disambiguation when items from different service types share names.
 *
 * Display format:
 * - Teams: "Service Type > Team Name" (e.g., "MANHATTAN > PRODUCTION")
 * - Positions: "Service Type > Team > Position" (e.g., "MANHATTAN > PRODUCTION > Technical Director")
 */

import { describe, it, expect } from "vitest";
import {
  formatTeamDisplayName,
  formatPositionDisplayName,
} from "../../functions/pcoServices/displayHelpers";

describe("PCO Services Hierarchical Display Format", () => {
  describe("formatTeamDisplayName", () => {
    it("formats team with service type context", () => {
      const result = formatTeamDisplayName("PRODUCTION", "MANHATTAN");
      expect(result).toBe("MANHATTAN > PRODUCTION");
    });

    it("handles single word names", () => {
      const result = formatTeamDisplayName("Band", "Sunday");
      expect(result).toBe("Sunday > Band");
    });

    it("handles spaces in names", () => {
      const result = formatTeamDisplayName("Production Team", "Sunday Morning Service");
      expect(result).toBe("Sunday Morning Service > Production Team");
    });

    it("returns team name only when service type is empty", () => {
      const result = formatTeamDisplayName("PRODUCTION", "");
      expect(result).toBe("PRODUCTION");
    });

    it("returns team name only when service type is undefined", () => {
      const result = formatTeamDisplayName("PRODUCTION", undefined);
      expect(result).toBe("PRODUCTION");
    });

    it("handles special characters in names", () => {
      const result = formatTeamDisplayName("A/V Team", "9:30 Service");
      expect(result).toBe("9:30 Service > A/V Team");
    });
  });

  describe("formatPositionDisplayName", () => {
    it("formats position with full hierarchy", () => {
      const result = formatPositionDisplayName(
        "Technical Director",
        "PRODUCTION",
        "MANHATTAN"
      );
      expect(result).toBe("MANHATTAN > PRODUCTION > Technical Director");
    });

    it("handles single word components", () => {
      const result = formatPositionDisplayName("Drums", "Band", "Sunday");
      expect(result).toBe("Sunday > Band > Drums");
    });

    it("handles spaces in all components", () => {
      const result = formatPositionDisplayName(
        "Lead Vocals",
        "Worship Team",
        "Sunday Morning"
      );
      expect(result).toBe("Sunday Morning > Worship Team > Lead Vocals");
    });

    it("returns position with team only when service type is empty", () => {
      const result = formatPositionDisplayName("Technical Director", "PRODUCTION", "");
      expect(result).toBe("PRODUCTION > Technical Director");
    });

    it("returns position with team only when service type is undefined", () => {
      const result = formatPositionDisplayName("Technical Director", "PRODUCTION", undefined);
      expect(result).toBe("PRODUCTION > Technical Director");
    });

    it("returns position only when both team and service type are empty", () => {
      const result = formatPositionDisplayName("Technical Director", "", "");
      expect(result).toBe("Technical Director");
    });

    it("returns position only when both team and service type are undefined", () => {
      const result = formatPositionDisplayName("Technical Director", undefined, undefined);
      expect(result).toBe("Technical Director");
    });

    it("returns position with service type when team is empty but service type exists", () => {
      const result = formatPositionDisplayName("Technical Director", "", "MANHATTAN");
      expect(result).toBe("MANHATTAN > Technical Director");
    });

    it("handles special characters in all components", () => {
      const result = formatPositionDisplayName(
        "A/V Coordinator",
        "Tech & Production",
        "9:30 AM Service"
      );
      expect(result).toBe("9:30 AM Service > Tech & Production > A/V Coordinator");
    });
  });

  describe("Real-world scenarios", () => {
    it("differentiates same team name across service types", () => {
      // Same team name "PRODUCTION" exists in multiple service types
      const manhattanProduction = formatTeamDisplayName("PRODUCTION", "MANHATTAN");
      const brooklynProduction = formatTeamDisplayName("PRODUCTION", "BROOKLYN");

      expect(manhattanProduction).toBe("MANHATTAN > PRODUCTION");
      expect(brooklynProduction).toBe("BROOKLYN > PRODUCTION");
      expect(manhattanProduction).not.toBe(brooklynProduction);
    });

    it("differentiates same position across teams and service types", () => {
      // Same position "Technical Director" exists in multiple contexts
      const mhTechDir = formatPositionDisplayName(
        "Technical Director",
        "PRODUCTION",
        "MANHATTAN"
      );
      const bkTechDir = formatPositionDisplayName(
        "Technical Director",
        "PRODUCTION",
        "BROOKLYN"
      );
      const mhWorshipTechDir = formatPositionDisplayName(
        "Technical Director",
        "WORSHIP",
        "MANHATTAN"
      );

      expect(mhTechDir).toBe("MANHATTAN > PRODUCTION > Technical Director");
      expect(bkTechDir).toBe("BROOKLYN > PRODUCTION > Technical Director");
      expect(mhWorshipTechDir).toBe("MANHATTAN > WORSHIP > Technical Director");

      // All three should be different
      expect(mhTechDir).not.toBe(bkTechDir);
      expect(mhTechDir).not.toBe(mhWorshipTechDir);
      expect(bkTechDir).not.toBe(mhWorshipTechDir);
    });

    it("handles empty position gracefully", () => {
      const result = formatPositionDisplayName("", "PRODUCTION", "MANHATTAN");
      expect(result).toBe("MANHATTAN > PRODUCTION > ");
    });
  });
});
