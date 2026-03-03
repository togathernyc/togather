import { formatCadence } from "../formatCadence";
import { Group } from "../../types";

describe("formatCadence", () => {
  // Helper to create a minimal group with day/time
  const createGroup = (day: number, time: string): Group => ({
    _id: "group_1",
    day,
    start_time: time,
  });

  describe("day name mapping (JavaScript convention: Sunday = 0)", () => {
    it("returns 'Sundays' for day 0", () => {
      const group = createGroup(0, "10:00:00");
      expect(formatCadence(group)).toBe("Sundays at 10:00am");
    });

    it("returns 'Mondays' for day 1", () => {
      const group = createGroup(1, "10:00:00");
      expect(formatCadence(group)).toBe("Mondays at 10:00am");
    });

    it("returns 'Tuesdays' for day 2", () => {
      const group = createGroup(2, "10:00:00");
      expect(formatCadence(group)).toBe("Tuesdays at 10:00am");
    });

    it("returns 'Wednesdays' for day 3", () => {
      const group = createGroup(3, "10:00:00");
      expect(formatCadence(group)).toBe("Wednesdays at 10:00am");
    });

    it("returns 'Thursdays' for day 4", () => {
      const group = createGroup(4, "10:00:00");
      expect(formatCadence(group)).toBe("Thursdays at 10:00am");
    });

    it("returns 'Fridays' for day 5", () => {
      const group = createGroup(5, "10:00:00");
      expect(formatCadence(group)).toBe("Fridays at 10:00am");
    });

    it("returns 'Saturdays' for day 6", () => {
      const group = createGroup(6, "10:00:00");
      expect(formatCadence(group)).toBe("Saturdays at 10:00am");
    });
  });

  describe("time formatting", () => {
    it("formats morning time correctly", () => {
      const group = createGroup(1, "09:30:00");
      expect(formatCadence(group)).toBe("Mondays at 9:30am");
    });

    it("formats noon correctly", () => {
      const group = createGroup(1, "12:00:00");
      expect(formatCadence(group)).toBe("Mondays at 12:00pm");
    });

    it("formats afternoon time correctly", () => {
      const group = createGroup(1, "14:31:00");
      expect(formatCadence(group)).toBe("Mondays at 2:31pm");
    });

    it("formats evening time correctly", () => {
      const group = createGroup(1, "19:00:00");
      expect(formatCadence(group)).toBe("Mondays at 7:00pm");
    });

    it("formats midnight correctly", () => {
      const group = createGroup(1, "00:00:00");
      expect(formatCadence(group)).toBe("Mondays at 12:00am");
    });

    it("handles HH:MM format without seconds", () => {
      const group = createGroup(1, "14:30");
      expect(formatCadence(group)).toBe("Mondays at 2:30pm");
    });
  });

  describe("alternative field names", () => {
    it("uses default_day and default_start_time when day/start_time not available", () => {
      const group: Group = {
        _id: "group_1",
        default_day: 3,
        default_start_time: "18:00:00",
      };
      expect(formatCadence(group)).toBe("Wednesdays at 6:00pm");
    });

    it("prefers day over default_day", () => {
      const group: Group = {
        _id: "group_1",
        day: 1,
        start_time: "10:00:00",
        default_day: 3,
        default_start_time: "18:00:00",
      };
      expect(formatCadence(group)).toBe("Mondays at 10:00am");
    });
  });

  describe("edge cases and null handling", () => {
    it("returns null for null group", () => {
      expect(formatCadence(null)).toBeNull();
    });

    it("returns null for undefined group", () => {
      expect(formatCadence(undefined)).toBeNull();
    });

    it("returns null when day is missing", () => {
      const group: Group = {
        _id: "group_1",
        start_time: "10:00:00",
      };
      expect(formatCadence(group)).toBeNull();
    });

    it("returns null when time is missing", () => {
      const group: Group = {
        _id: "group_1",
        day: 1,
      };
      expect(formatCadence(group)).toBeNull();
    });

    it("returns null for invalid day (negative)", () => {
      const group = createGroup(-1, "10:00:00");
      expect(formatCadence(group)).toBeNull();
    });

    it("returns null for invalid day (> 6)", () => {
      const group = createGroup(7, "10:00:00");
      expect(formatCadence(group)).toBeNull();
    });

    it("returns null for invalid time format", () => {
      const group = createGroup(1, "invalid");
      expect(formatCadence(group)).toBeNull();
    });
  });

  describe("extracting day from first_meeting_date", () => {
    // Helper to create a local date string for a specific day of week
    // This ensures tests work regardless of timezone
    const createLocalDateForDay = (targetDayOfWeek: number, hour: number, minute: number): string => {
      // Start from a known date and find the next occurrence of the target day
      const date = new Date(2024, 0, 1); // Jan 1, 2024 is a Monday (day 1)
      // Adjust to find the target day of week
      const daysToAdd = (targetDayOfWeek - date.getDay() + 7) % 7;
      date.setDate(date.getDate() + daysToAdd);
      date.setHours(hour, minute, 0, 0);
      return date.toISOString();
    };

    it("extracts correct day from a Wednesday date", () => {
      // Create a date that is Wednesday in local timezone
      const wednesdayDate = createLocalDateForDay(3, 14, 30); // Wednesday at 2:30pm local
      const group: Group = {
        _id: "group_1",
        group_schedule_details: {
          first_meeting_date: wednesdayDate,
        },
      };
      expect(formatCadence(group)).toBe("Wednesdays at 2:30pm");
    });

    it("extracts correct day from a Sunday date", () => {
      // Create a date that is Sunday in local timezone
      const sundayDate = createLocalDateForDay(0, 10, 0); // Sunday at 10:00am local
      const group: Group = {
        _id: "group_1",
        group_schedule_details: {
          first_meeting_date: sundayDate,
        },
      };
      expect(formatCadence(group)).toBe("Sundays at 10:00am");
    });

    it("extracts correct day from a Saturday date", () => {
      // Create a date that is Saturday in local timezone
      const saturdayDate = createLocalDateForDay(6, 15, 0); // Saturday at 3:00pm local
      const group: Group = {
        _id: "group_1",
        group_schedule_details: {
          first_meeting_date: saturdayDate,
        },
      };
      expect(formatCadence(group)).toBe("Saturdays at 3:00pm");
    });
  });
});
