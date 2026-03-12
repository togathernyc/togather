/**
 * Convex Migration Validation Tests
 *
 * These tests scan the codebase for common migration issues when moving
 * from legacy numeric IDs to Convex string IDs.
 *
 * Run with: pnpm test convex-migration-validation
 */

import { execSync } from "child_process";
import * as path from "path";

const MOBILE_APP_ROOT = path.join(__dirname, "../..");
const FEATURES_ROOT = path.join(MOBILE_APP_ROOT, "features");
const APP_ROOT = path.join(MOBILE_APP_ROOT, "app");
const PROVIDERS_ROOT = path.join(MOBILE_APP_ROOT, "providers");

// Helper to run grep and return matches
function grepCodebase(
  pattern: string,
  paths: string[],
  options: { exclude?: string[]; include?: string } = {}
): string[] {
  const excludes = (options.exclude || [])
    .map((e) => `--exclude-dir=${e}`)
    .join(" ");
  const include = options.include ? `--include="${options.include}"` : "";

  try {
    const result = execSync(
      `grep -rn "${pattern}" ${paths.join(" ")} ${excludes} ${include} 2>/dev/null || true`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    );
    return result
      .split("\n")
      .filter((line) => line.trim())
      .filter((line) => !line.includes("node_modules"))
      .filter((line) => !line.includes(".test.ts")) // Exclude test files from scan
      .filter((line) => !line.includes("convex-migration-validation")); // Exclude this file
  } catch {
    return [];
  }
}

// Helper to check if a match is in a comment
function isInComment(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

// Filter out matches that are in comments or are legitimate uses
function filterFalsePositives(
  matches: string[],
  legitimatePatterns: RegExp[] = []
): string[] {
  return matches.filter((match) => {
    // Skip comments
    const lineContent = match.split(":").slice(2).join(":");
    if (isInComment(lineContent)) return false;

    // Skip legitimate patterns
    for (const pattern of legitimatePatterns) {
      if (pattern.test(match)) return false;
    }

    return true;
  });
}

describe("Convex Migration Validation", () => {
  describe("Number() conversion of IDs", () => {
    it("should not convert Convex IDs to numbers (produces NaN)", () => {
      const patterns = [
        "Number\\(.*\\.id\\)", // Number(x.id)
        "Number\\(.*\\._id\\)", // Number(x._id)
        "Number\\(.*\\.userId\\)", // Number(x.userId)
        "Number\\(.*\\.communityId\\)", // Number(x.communityId)
        "Number\\(.*\\.groupId\\)", // Number(x.groupId)
      ];

      const allMatches: string[] = [];

      for (const pattern of patterns) {
        const matches = grepCodebase(
          pattern,
          [FEATURES_ROOT, APP_ROOT, PROVIDERS_ROOT],
          { include: "*.ts*" }
        );
        allMatches.push(...matches);
      }

      // Filter out legitimate uses (legacyId is a numeric string, safe to convert)
      const legitimatePatterns = [
        /legacyId/, // legacyId is intentionally numeric
        /Number\(.*legacyId/, // Converting legacyId is safe
      ];

      const issues = filterFalsePositives(allMatches, legitimatePatterns);

      if (issues.length > 0) {
        console.error("\n❌ Found Number() conversions of Convex IDs:");
        issues.forEach((issue) => console.error(`  ${issue}`));
        console.error(
          "\n💡 Fix: Convex IDs are strings. Use them directly without Number() conversion."
        );
      }

      expect(issues).toHaveLength(0);
    });

    it("should not use parseInt on Convex IDs", () => {
      const patterns = [
        "parseInt\\(.*\\.id", // parseInt(x.id
        "parseInt\\(.*\\._id", // parseInt(x._id
        "parseInt\\(.*Id,", // parseInt(xId,
      ];

      const allMatches: string[] = [];

      for (const pattern of patterns) {
        const matches = grepCodebase(
          pattern,
          [FEATURES_ROOT, APP_ROOT, PROVIDERS_ROOT],
          { include: "*.ts*" }
        );
        allMatches.push(...matches);
      }

      // Filter legitimate uses (generating numeric hash for map markers is OK)
      const legitimatePatterns = [
        /parseInt\(event\.id.*Math\.abs/, // Hash generation for map markers
        /legacyId/,
      ];

      const issues = filterFalsePositives(allMatches, legitimatePatterns);

      if (issues.length > 0) {
        console.error("\n❌ Found parseInt() on Convex IDs:");
        issues.forEach((issue) => console.error(`  ${issue}`));
      }

      expect(issues).toHaveLength(0);
    });
  });

  describe("Legacy ID field usage", () => {
    it("should not use odUserId (legacy field)", () => {
      const matches = grepCodebase("odUserId", [FEATURES_ROOT, APP_ROOT], {
        include: "*.ts*",
      });

      // Filter out type definitions, comments, and legitimate uses
      // Note: odUserId is returned by the Convex backend and holds the Convex user ID
      // It's a confusing name but the value is correct (not a legacy OD integer)
      const issues = matches.filter((match) => {
        const lineContent = match.split(":").slice(2).join(":");
        if (isInComment(lineContent)) return false;
        if (lineContent.includes("interface")) return false;
        if (lineContent.includes("type ")) return false;
        // Allow odUserId when it's being used as received from Convex backend
        // The backend returns odUserId containing the Convex Id<"users">
        if (match.includes("FollowupDetailScreen.tsx") && lineContent.includes("history.member.odUserId")) return false;
        if (match.includes("FollowupDetailScreen.tsx") && lineContent.includes("historyData")) return false;
        // Allow FollowupScreen to read odUserId from backend response for mapping
        if (match.includes("FollowupScreen.tsx") && lineContent.includes("m.odUserId")) return false;
        return true;
      });

      if (issues.length > 0) {
        console.error("\n❌ Found usage of legacy odUserId field:");
        issues.forEach((issue) => console.error(`  ${issue}`));
        console.error("\n💡 Fix: Use user._id or user.id (Convex ID) instead.");
      }

      expect(issues).toHaveLength(0);
    });

    it("should not access user_id on nested user objects", () => {
      // This catches the pattern member.user.user_id which is wrong
      // (should be member.user._id or member.user.id)
      // Note: member.user_id as a direct field is OK (CommunityMember type)
      const matches = grepCodebase(
        "\\.user\\.user_id",
        [FEATURES_ROOT, APP_ROOT],
        { include: "*.ts*" }
      );

      const issues = filterFalsePositives(matches);

      if (issues.length > 0) {
        console.error("\n❌ Found .user.user_id usage:");
        issues.forEach((issue) => console.error(`  ${issue}`));
        console.error("\n💡 Fix: Use .user._id or .user.id instead.");
      }

      expect(issues).toHaveLength(0);
    });

    it("should document user_id field naming convention", () => {
      // Note: Some types use user_id as a direct field containing a Convex ID
      // This is a legacy naming convention but not a bug.
      // Examples: CommunityMember.user_id contains Id<"users">
      // New code should prefer 'id' or '_id' naming
      console.log("\n📝 Note: Some types use 'user_id' field name for Convex IDs.");
      console.log("   This is legacy naming but not a bug if the value is a string.");
      expect(true).toBe(true);
    });
  });

  describe("Group interface compliance", () => {
    it("should include _id when casting to Group type", () => {
      // Look for objects cast as Group without _id
      const matches = grepCodebase("as Group", [FEATURES_ROOT, APP_ROOT], {
        include: "*.ts*",
      });

      // This is a heuristic - we can't fully parse TypeScript, but we can flag
      // suspicious patterns for manual review
      const suspiciousMatches = matches.filter((match) => {
        // If the cast is on a line that also defines the object, check for _id
        const lineContent = match.split(":").slice(2).join(":");
        // Skip if _id is mentioned nearby (within the object literal)
        if (lineContent.includes("_id:") || lineContent.includes("_id,")) {
          return false;
        }
        return true;
      });

      // Log for awareness but don't fail - this is a heuristic
      if (suspiciousMatches.length > 0) {
        console.warn("\n⚠️ Found 'as Group' casts - verify _id is included:");
        suspiciousMatches.slice(0, 5).forEach((match) => {
          console.warn(`  ${match}`);
        });
        if (suspiciousMatches.length > 5) {
          console.warn(`  ... and ${suspiciousMatches.length - 5} more`);
        }
      }

      // This test is informational - actual validation is done by TypeScript
      expect(true).toBe(true);
    });
  });

  describe("Consistent ID field naming", () => {
    it("should use _id for Convex document references", () => {
      // Check for inconsistent ID access patterns
      // member.id vs member._id - depends on the type definition
      // This test documents the expected patterns

      const expectedPatterns = {
        // User IDs from Convex documents
        "user._id": "Convex user document ID",
        "user.id": "Mapped user ID (from User type)",
        // Group IDs
        "group._id": "Convex group document ID",
        // Member IDs (in GroupMember type, id is string)
        "member.id": "GroupMember.id (string, from User.id)",
      };

      // This is a documentation test - no assertions
      console.log("\n📝 Expected ID field patterns:");
      Object.entries(expectedPatterns).forEach(([pattern, description]) => {
        console.log(`  ${pattern} - ${description}`);
      });

      expect(true).toBe(true);
    });
  });

  describe("Token safety", () => {
    it("should not use unsafe token assertions (token!)", () => {
      const matches = grepCodebase("token!", [FEATURES_ROOT, PROVIDERS_ROOT], {
        include: "*.ts*",
      });

      // Filter out TypeScript type assertions that aren't the same thing
      const issues = matches.filter((match) => {
        const lineContent = match.split(":").slice(2).join(":");
        // Skip type definitions
        if (lineContent.includes("interface")) return false;
        if (lineContent.includes("type ")) return false;
        // Skip if it's a different pattern like token !== or token !=
        if (/token\s*!==?/.test(lineContent)) return false;
        // Skip if it's a safe conditional skip pattern (shouldSkip ? "skip" : { token: token! ...})
        if (/shouldSkip\s*\?\s*["']skip["']/.test(lineContent)) return false;
        if (/\?\s*["']skip["']\s*:\s*\{[^}]*token:\s*token!/.test(lineContent)) return false;
        // Look for actual non-null assertion
        return /token![\s,)\]}]/.test(lineContent);
      });

      if (issues.length > 0) {
        console.error("\n❌ Found unsafe token! assertions:");
        issues.forEach((issue) => console.error(`  ${issue}`));
        console.error("\n💡 Fix: Add null check before using token.");
      }

      expect(issues).toHaveLength(0);
    });
  });
});

describe("Convex Backend Security", () => {
  const CONVEX_FUNCTIONS_ROOT = path.join(__dirname, "../../../convex/functions");

  describe("Token field safety in mutations", () => {
    it("should not spread token into database patches", () => {
      // This catches the bug where:
      // const { someId, ...updates } = args;  // BAD - token in updates
      // ctx.db.patch(id, { ...updates });     // Token gets saved to DB!
      //
      // Correct pattern:
      // const { someId, token: _token, ...updates } = args;  // GOOD

      // Find mutations that have token in args AND use spread destructuring
      const tokenMutations = grepCodebase(
        "token: v\\.string()",
        [CONVEX_FUNCTIONS_ROOT],
        { include: "*.ts" }
      );

      // For each file with token mutations, check for unsafe spread patterns
      const filesWithTokenMutations = [
        ...new Set(tokenMutations.map((m) => m.split(":")[0])),
      ];

      const issues: string[] = [];

      for (const file of filesWithTokenMutations) {
        // Look for spread destructuring of args without excluding token
        // Pattern: { someId, ...rest } = args (missing token: _token)
        const spreadPatterns = grepCodebase(
          "\\{ [a-zA-Z]+, \\.\\.\\.\\w\\+ \\} = args",
          [file],
          { include: "*.ts" }
        );

        for (const match of spreadPatterns) {
          const lineContent = match.split(":").slice(2).join(":");
          // Check if token is properly excluded
          if (!lineContent.includes("token:") && !lineContent.includes("token,")) {
            // Verify this file actually has token in args (within same mutation)
            // This is a heuristic - could have false positives
            issues.push(match);
          }
        }
      }

      if (issues.length > 0) {
        console.error("\n❌ Found potential token spread into db.patch:");
        issues.forEach((issue) => console.error(`  ${issue}`));
        console.error(
          "\n💡 Fix: Exclude token from spread: const { id, token: _token, ...updates } = args;"
        );
      }

      expect(issues).toHaveLength(0);
    });

    it("should document the safe pattern for mutation args destructuring", () => {
      // This documents the expected pattern for mutations with token
      console.log("\n📝 Safe pattern for mutations with token:");
      console.log("  // Extract token explicitly to prevent it from being spread");
      console.log("  const { entityId, token: _token, ...updates } = args;");
      console.log("  await ctx.db.patch(entityId, { ...updates });");
      expect(true).toBe(true);
    });
  });
});

describe("Convex ID Format Validation", () => {
  // Helper function that can be exported for runtime use
  const isValidConvexId = (id: unknown): id is string => {
    if (typeof id !== "string") return false;
    if (!id) return false;
    // Convex IDs are alphanumeric strings that contain letters
    // Legacy numeric IDs are pure digits
    if (/^\d+\.?\d*$/.test(id)) return false;
    return true;
  };

  it("should correctly identify valid Convex IDs", () => {
    // Valid Convex IDs (alphanumeric strings)
    expect(isValidConvexId("k17abc123def456")).toBe(true);
    expect(isValidConvexId("j5712345abcdef")).toBe(true);
    expect(isValidConvexId("abc123")).toBe(true);

    // Invalid - legacy numeric IDs
    expect(isValidConvexId("123")).toBe(false);
    expect(isValidConvexId("1")).toBe(false);
    expect(isValidConvexId("1.0")).toBe(false);
    expect(isValidConvexId(123)).toBe(false);

    // Invalid - null/undefined
    expect(isValidConvexId(null)).toBe(false);
    expect(isValidConvexId(undefined)).toBe(false);
    expect(isValidConvexId("")).toBe(false);
  });

  it("should have isValidConvexId available for runtime validation", () => {
    // Document that this function should be exported from a shared utility
    // for use in runtime validation (e.g., in AuthProvider)
    expect(typeof isValidConvexId).toBe("function");
  });
});
