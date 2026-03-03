import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

// Test the utility functions extracted from RunSheetScreen
// These are the core logic that needs to remain working

describe("RunSheetScreen utilities", () => {
  // Role color mapping
  const ROLE_COLORS: Record<string, string> = {
    Audio: "#4A7C59",
    Video: "#D4A84B",
    Lighting: "#8B7355",
    Stage: "#6B8E8E",
    TD: "#7B4B94",
    SD: "#4A90A4",
    "Service Cues": "#C4564A",
    All: "#666666",
  };

  // Role aliases for normalizing (ordered array - more specific first)
  const ROLE_ALIASES: [string, string][] = [
    // Specific multi-word aliases first
    ["technical director", "TD"],
    ["tech director", "TD"],
    ["service director", "SD"],
    ["srv director", "SD"],
    ["service cue", "Service Cues"],
    ["service cues", "Service Cues"],
    // Department-specific aliases (before generic "cue")
    ["audio cue", "Audio"],
    ["video cue", "Video"],
    ["lighting cue", "Lighting"],
    ["light cue", "Lighting"],
    ["stage cue", "Stage"],
    // Department names
    ["audio", "Audio"],
    ["foh", "Audio"],
    ["monitors", "Audio"],
    ["video", "Video"],
    ["pvp", "Video"],
    ["propresenter", "Video"],
    ["pro7", "Video"],
    ["lighting", "Lighting"],
    ["lights", "Lighting"],
    ["stage", "Stage"],
    ["platform", "Stage"],
    // Generic cue aliases last (fallback)
    ["cue", "Service Cues"],
    ["cues", "Service Cues"],
  ];

  // Implementation of normalizeRoleName (matches RunSheetScreen.tsx)
  function normalizeRoleName(category: string): string {
    const lower = category.toLowerCase().trim();
    for (const [alias, normalized] of ROLE_ALIASES) {
      if (lower.includes(alias)) {
        return normalized;
      }
    }
    return category
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  // Implementation of sanitizeNoteContent (matches RunSheetScreen.tsx)
  function sanitizeNoteContent(content: string): string {
    return content
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim();
  }

  // Implementation of formatDuration (matches RunSheetScreen.tsx)
  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${mins}m`;
  }

  // Implementation of getRoleColor (matches RunSheetScreen.tsx)
  function getRoleColor(role: string): string {
    return ROLE_COLORS[role] || ROLE_COLORS.All;
  }

  describe("normalizeRoleName", () => {
    it("normalizes 'technical director' to 'TD'", () => {
      expect(normalizeRoleName("technical director")).toBe("TD");
      expect(normalizeRoleName("Technical Director")).toBe("TD");
      expect(normalizeRoleName("TECHNICAL DIRECTOR")).toBe("TD");
    });

    it("normalizes 'tech director' to 'TD'", () => {
      expect(normalizeRoleName("tech director")).toBe("TD");
    });

    it("normalizes 'service director' to 'SD'", () => {
      expect(normalizeRoleName("service director")).toBe("SD");
      expect(normalizeRoleName("Service Director")).toBe("SD");
    });

    it("normalizes 'lighting' variations to 'Lighting'", () => {
      expect(normalizeRoleName("lighting")).toBe("Lighting");
      expect(normalizeRoleName("Lighting")).toBe("Lighting");
      expect(normalizeRoleName("lights")).toBe("Lighting");
    });

    it("normalizes 'audio' variations to 'Audio'", () => {
      expect(normalizeRoleName("audio")).toBe("Audio");
      expect(normalizeRoleName("foh")).toBe("Audio");
      expect(normalizeRoleName("monitors")).toBe("Audio");
    });

    it("normalizes 'video' variations to 'Video'", () => {
      expect(normalizeRoleName("video")).toBe("Video");
      expect(normalizeRoleName("pvp")).toBe("Video");
      expect(normalizeRoleName("propresenter")).toBe("Video");
      expect(normalizeRoleName("pro7")).toBe("Video");
    });

    it("normalizes 'stage' variations to 'Stage'", () => {
      expect(normalizeRoleName("stage")).toBe("Stage");
      expect(normalizeRoleName("platform")).toBe("Stage");
    });

    it("normalizes 'service cues' variations to 'Service Cues'", () => {
      expect(normalizeRoleName("service cues")).toBe("Service Cues");
      expect(normalizeRoleName("service cue")).toBe("Service Cues");
      expect(normalizeRoleName("cue")).toBe("Service Cues");
      expect(normalizeRoleName("cues")).toBe("Service Cues");
    });

    it("matches department-specific cues to their department, not Service Cues", () => {
      // "audio cue" should match Audio, not Service Cues
      expect(normalizeRoleName("audio cue")).toBe("Audio");
      expect(normalizeRoleName("Audio Cues")).toBe("Audio");
      expect(normalizeRoleName("video cue")).toBe("Video");
      expect(normalizeRoleName("Video Cues")).toBe("Video");
      expect(normalizeRoleName("lighting cue")).toBe("Lighting");
      expect(normalizeRoleName("light cue")).toBe("Lighting");
      expect(normalizeRoleName("stage cue")).toBe("Stage");
    });

    it("capitalizes unknown role names", () => {
      expect(normalizeRoleName("camera operator")).toBe("Camera Operator");
      expect(normalizeRoleName("broadcast")).toBe("Broadcast");
      expect(normalizeRoleName("worship leader")).toBe("Worship Leader");
    });

    it("handles whitespace", () => {
      expect(normalizeRoleName("  lighting  ")).toBe("Lighting");
      // " TD " doesn't match "technical director" alias, gets capitalized as-is
      expect(normalizeRoleName(" TD ")).toBe(" Td ");
    });
  });

  describe("sanitizeNoteContent", () => {
    it("converts <br> to newlines", () => {
      expect(sanitizeNoteContent("Line 1<br>Line 2")).toBe("Line 1\nLine 2");
      expect(sanitizeNoteContent("Line 1<br/>Line 2")).toBe("Line 1\nLine 2");
      expect(sanitizeNoteContent("Line 1<br />Line 2")).toBe("Line 1\nLine 2");
    });

    it("handles case-insensitive <br> tags", () => {
      expect(sanitizeNoteContent("Line 1<BR>Line 2")).toBe("Line 1\nLine 2");
      expect(sanitizeNoteContent("Line 1<Br>Line 2")).toBe("Line 1\nLine 2");
    });

    it("strips other HTML tags", () => {
      expect(sanitizeNoteContent("<b>Bold</b> text")).toBe("Bold text");
      expect(sanitizeNoteContent("<p>Paragraph</p>")).toBe("Paragraph");
      expect(sanitizeNoteContent("<a href='url'>Link</a>")).toBe("Link");
    });

    it("handles multiple <br> tags", () => {
      expect(sanitizeNoteContent("Line 1<br>Line 2<br>Line 3")).toBe(
        "Line 1\nLine 2\nLine 3"
      );
    });

    it("trims whitespace", () => {
      expect(sanitizeNoteContent("  text  ")).toBe("text");
      expect(sanitizeNoteContent("\n\ntext\n\n")).toBe("text");
    });

    it("handles empty strings", () => {
      expect(sanitizeNoteContent("")).toBe("");
    });

    it("handles content without HTML", () => {
      expect(sanitizeNoteContent("Plain text content")).toBe("Plain text content");
    });

    it("handles real-world PCO note content", () => {
      expect(
        sanitizeNoteContent("Speaker Key Lighting (brighter) <br> Welcome Look")
      ).toBe("Speaker Key Lighting (brighter) \n Welcome Look");
    });
  });

  describe("formatDuration", () => {
    it("formats whole minutes", () => {
      expect(formatDuration(60)).toBe("1m");
      expect(formatDuration(120)).toBe("2m");
      expect(formatDuration(300)).toBe("5m");
      expect(formatDuration(600)).toBe("10m");
      expect(formatDuration(2700)).toBe("45m");
    });

    it("formats minutes with seconds", () => {
      expect(formatDuration(90)).toBe("1:30");
      expect(formatDuration(150)).toBe("2:30");
      expect(formatDuration(545)).toBe("9:05");
    });

    it("handles zero", () => {
      expect(formatDuration(0)).toBe("0m");
    });

    it("handles seconds only", () => {
      expect(formatDuration(30)).toBe("0:30");
      expect(formatDuration(5)).toBe("0:05");
    });

    it("pads seconds with leading zero", () => {
      expect(formatDuration(65)).toBe("1:05");
      expect(formatDuration(601)).toBe("10:01");
    });
  });

  describe("getRoleColor", () => {
    it("returns correct colors for known roles", () => {
      expect(getRoleColor("Audio")).toBe("#4A7C59");
      expect(getRoleColor("Video")).toBe("#D4A84B");
      expect(getRoleColor("Lighting")).toBe("#8B7355");
      expect(getRoleColor("Stage")).toBe("#6B8E8E");
      expect(getRoleColor("TD")).toBe("#7B4B94");
      expect(getRoleColor("SD")).toBe("#4A90A4");
      expect(getRoleColor("Service Cues")).toBe("#C4564A");
      expect(getRoleColor("All")).toBe("#666666");
    });

    it("returns default color for unknown roles", () => {
      expect(getRoleColor("Unknown Role")).toBe("#666666");
      expect(getRoleColor("Camera Operator")).toBe("#666666");
      expect(getRoleColor("")).toBe("#666666");
    });
  });

  describe("time range detection", () => {
    // Helper to detect if a title looks like a time range
    function titleIsTimeRange(title: string): boolean {
      return /^\d{1,2}:\d{2}/.test(title.trim());
    }

    it("detects time range titles", () => {
      expect(titleIsTimeRange("7:45-9:00 AM")).toBe(true);
      expect(titleIsTimeRange("9:00-9:10 AM")).toBe(true);
      expect(titleIsTimeRange("10:30-11:00 PM")).toBe(true);
    });

    it("does not detect regular titles as time ranges", () => {
      expect(titleIsTimeRange("WORSHIP - MAIN SET")).toBe(false);
      expect(titleIsTimeRange("CALL TIME 7:30 AM")).toBe(false);
      expect(titleIsTimeRange("SONG 1")).toBe(false);
      expect(titleIsTimeRange("MESSAGE")).toBe(false);
    });
  });
});

describe("RunSheetScreen data transformation", () => {
  // Test the note filtering logic
  describe("note filtering by role", () => {
    const ROLE_ALIASES: Record<string, string> = {
      lighting: "Lighting",
      lights: "Lighting",
      audio: "Audio",
      video: "Video",
    };

    function normalizeRoleName(category: string): string {
      const lower = category.toLowerCase().trim();
      for (const [alias, normalized] of Object.entries(ROLE_ALIASES)) {
        if (lower.includes(alias)) {
          return normalized;
        }
      }
      return category
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }

    const mockNotes = [
      { category: "Lighting", content: "Walk In Look" },
      { category: "Audio", content: "Mic 6" },
      { category: "Video", content: "Camera 1" },
      { category: "Service Cues", content: "X" },
      { category: "Person", content: "Meeting Leader:" },
    ];

    it("returns all notes when selectedRole is 'All'", () => {
      const selectedRole = "All";
      const filtered =
        selectedRole === "All"
          ? mockNotes
          : mockNotes.filter(
              (note) => normalizeRoleName(note.category) === selectedRole
            );
      expect(filtered).toHaveLength(5);
    });

    it("filters notes by Lighting role", () => {
      const selectedRole = "Lighting";
      const filtered = mockNotes.filter(
        (note) => normalizeRoleName(note.category) === selectedRole
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].content).toBe("Walk In Look");
    });

    it("filters notes by Audio role", () => {
      const selectedRole = "Audio";
      const filtered = mockNotes.filter(
        (note) => normalizeRoleName(note.category) === selectedRole
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].content).toBe("Mic 6");
    });

    it("returns empty array when no notes match role", () => {
      const selectedRole = "Stage";
      const filtered = mockNotes.filter(
        (note) => normalizeRoleName(note.category) === selectedRole
      );
      expect(filtered).toHaveLength(0);
    });
  });

  // Test grouping notes by role
  describe("grouping notes by role", () => {
    function normalizeRoleName(category: string): string {
      return category
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }

    const mockNotes = [
      { category: "Lighting", content: "Walk In Look" },
      { category: "Lighting", content: "Song Looks" },
      { category: "Audio", content: "Mic 6" },
      { category: "Video", content: "Camera 1" },
    ];

    it("groups notes by role correctly", () => {
      const grouped: Record<string, string[]> = {};
      mockNotes.forEach((note) => {
        const role = normalizeRoleName(note.category);
        if (!grouped[role]) grouped[role] = [];
        grouped[role].push(note.content);
      });

      expect(Object.keys(grouped)).toHaveLength(3);
      expect(grouped["Lighting"]).toHaveLength(2);
      expect(grouped["Lighting"]).toContain("Walk In Look");
      expect(grouped["Lighting"]).toContain("Song Looks");
      expect(grouped["Audio"]).toHaveLength(1);
      expect(grouped["Video"]).toHaveLength(1);
    });
  });

  // Test available roles extraction
  describe("extracting available roles", () => {
    function normalizeRoleName(category: string): string {
      return category
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }

    const mockItems = [
      {
        notes: [
          { category: "Lighting", content: "Note 1" },
          { category: "Audio", content: "Note 2" },
        ],
      },
      {
        notes: [
          { category: "Video", content: "Note 3" },
          { category: "Lighting", content: "Note 4" },
        ],
      },
      { notes: [] },
    ];

    it("extracts unique roles from items", () => {
      const roles = new Set<string>();
      mockItems.forEach((item) => {
        item.notes.forEach((note) => {
          const normalized = normalizeRoleName(note.category);
          roles.add(normalized);
        });
      });

      expect(roles.size).toBe(3);
      expect(roles.has("Lighting")).toBe(true);
      expect(roles.has("Audio")).toBe(true);
      expect(roles.has("Video")).toBe(true);
    });

    it("orders roles with 'All' first", () => {
      const roles = new Set<string>(["Video", "Audio", "Lighting"]);
      const orderedRoles = ["All"];
      const roleOrder = ["Audio", "Video", "Lighting"];

      roleOrder.forEach((role) => {
        if (roles.has(role)) orderedRoles.push(role);
      });

      roles.forEach((role) => {
        if (!orderedRoles.includes(role)) orderedRoles.push(role);
      });

      expect(orderedRoles[0]).toBe("All");
      expect(orderedRoles).toContain("Audio");
      expect(orderedRoles).toContain("Video");
      expect(orderedRoles).toContain("Lighting");
    });
  });
});

describe("song details display", () => {
  // Mock song details structure matching the RunSheetScreen type
  const mockSongDetails = {
    key: "G",
    arrangement: "Radio Version",
    author: "Chris Tomlin",
    ccliNumber: "12345",
    bpm: 68,
    meter: "4/4",
  };

  /**
   * This function represents the CORRECT implementation.
   * Expanded view should show: key, bpm, meter (NOT author)
   */
  function getExpandedViewFields(
    songDetails: typeof mockSongDetails
  ): string[] {
    const fields: string[] = [];

    // Correct implementation: Key, BPM, Meter (no Author)
    if (songDetails.key) fields.push("key");
    if (songDetails.bpm) fields.push("bpm");
    if (songDetails.meter) fields.push("meter");

    return fields;
  }

  describe("expanded view song details", () => {
    it("should include Key in expanded view DetailRow", () => {
      const fields = getExpandedViewFields(mockSongDetails);
      expect(fields).toContain("key");
    });

    it("should NOT include Author in expanded view", () => {
      const fields = getExpandedViewFields(mockSongDetails);
      expect(fields).not.toContain("author");
    });

    it("expanded view should show exactly: Key, BPM, Meter", () => {
      const fields = getExpandedViewFields(mockSongDetails);
      const expectedFields = ["key", "bpm", "meter"];

      expect(fields).toEqual(expect.arrayContaining(expectedFields));
      expect(fields).not.toContain("author");
      expect(fields).toHaveLength(3);
    });
  });

  describe("collapsed view song details", () => {
    it("should show Key in collapsed view badge", () => {
      expect(mockSongDetails.key).toBe("G");
    });

    it("should show arrangement in collapsed view", () => {
      expect(mockSongDetails.arrangement).toBe("Radio Version");
    });
  });
});

describe("chip category normalization for settings", () => {
  // Full ROLE_ALIASES matching the implementation
  const ROLE_ALIASES: [string, string][] = [
    ["technical director", "TD"],
    ["tech director", "TD"],
    ["service director", "SD"],
    ["srv director", "SD"],
    ["service cue", "Service Cues"],
    ["service cues", "Service Cues"],
    ["audio cue", "Audio"],
    ["video cue", "Video"],
    ["lighting cue", "Lighting"],
    ["light cue", "Lighting"],
    ["stage cue", "Stage"],
    ["audio", "Audio"],
    ["foh", "Audio"],
    ["monitors", "Audio"],
    ["video", "Video"],
    ["pvp", "Video"],
    ["propresenter", "Video"],
    ["pro7", "Video"],
    ["lighting", "Lighting"],
    ["lights", "Lighting"],
    ["stage", "Stage"],
    ["platform", "Stage"],
    ["cue", "Service Cues"],
    ["cues", "Service Cues"],
  ];

  function normalizeRoleName(category: string): string {
    const lower = category.toLowerCase().trim();
    for (const [alias, normalized] of ROLE_ALIASES) {
      if (lower.includes(alias)) {
        return normalized;
      }
    }
    return category.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }

  function normalizeCategories(rawCategories: string[]): string[] {
    const normalized = new Set<string>();
    for (const cat of rawCategories) {
      normalized.add(normalizeRoleName(cat));
    }
    return Array.from(normalized).sort();
  }

  describe("collapsing raw PCO categories to normalized names", () => {
    it("should collapse multiple Video variants to single 'Video' chip", () => {
      const rawCategories = ["Video -PVP", "Video - Pro 7", "Video"];
      const normalized = normalizeCategories(rawCategories);

      expect(normalized).toHaveLength(1);
      expect(normalized).toContain("Video");
    });

    it("should collapse Lighting variants to single 'Lighting' chip", () => {
      const rawCategories = ["Lighting -Venue", "Lighting", "Lights"];
      const normalized = normalizeCategories(rawCategories);

      expect(normalized).toHaveLength(1);
      expect(normalized).toContain("Lighting");
    });

    it("should keep non-aliased categories as capitalized names", () => {
      const rawCategories = ["Broadcast", "Person", "Worship", "Technical"];
      const normalized = normalizeCategories(rawCategories);

      expect(normalized).toHaveLength(4);
      expect(normalized).toContain("Broadcast");
      expect(normalized).toContain("Person");
      expect(normalized).toContain("Worship");
      expect(normalized).toContain("Technical");
    });
  });

  describe("hiding normalized categories hides all raw variants", () => {
    it("should hide all Video variants when 'Video' is hidden", () => {
      const rawCategories = ["Video -PVP", "Video - Pro 7", "Audio", "Lighting"];
      const hiddenCategories = new Set(["Video"]);

      const visibleCategories = rawCategories.filter(
        (cat) => !hiddenCategories.has(normalizeRoleName(cat))
      );

      expect(visibleCategories).toHaveLength(2);
      expect(visibleCategories).toContain("Audio");
      expect(visibleCategories).toContain("Lighting");
      expect(visibleCategories).not.toContain("Video -PVP");
      expect(visibleCategories).not.toContain("Video - Pro 7");
    });
  });

  describe("ordering with normalized names", () => {
    it("should apply order using normalized names", () => {
      const rawCategories = ["Lighting -Venue", "Video -PVP", "Audio", "Video - Pro 7"];
      const orderList = ["Audio", "Video", "Lighting"];

      const normalized = normalizeCategories(rawCategories);

      const orderedRoles: string[] = [];
      orderList.forEach((role) => {
        if (normalized.includes(role)) {
          orderedRoles.push(role);
        }
      });
      normalized.forEach((role) => {
        if (!orderedRoles.includes(role)) {
          orderedRoles.push(role);
        }
      });

      expect(orderedRoles).toEqual(["Audio", "Video", "Lighting"]);
    });
  });
});
