/**
 * Slack Service Planning Bot Tests
 *
 * Tests for the FOUNT-specific service planning bot.
 * Focuses on pure functions that don't require DB or external APIs:
 * - Slack signature verification
 * - Nag urgency selection by day of week
 * - Missing items detection from parsed service plan
 * - Message formatting (thread creation, nag messages, confirmations)
 * - New message builders (generated content, PCO sync confirmation)
 *
 * Run with: cd apps/convex && pnpm test __tests__/slackServiceBot.test.ts
 */

import { expect, test, describe } from "vitest";
import { verifySlackSignature } from "../functions/slackServiceBot/slack";
import {
  getMissingItems,
  getResponsibleMembers,
  getNagDueNow,
  buildNagMessage,
  buildThreadCreationMessage,
  buildThreadIntroMessage,
  buildConfirmationMessage,
  buildGeneratedContentMessage,
  buildPcoSyncConfirmation,
  type ServicePlanState,
  type BotIntent,
  type IntentResult,
} from "../functions/slackServiceBot/ai";
import {
  TEAM_MEMBERS,
  ACTIVE_MENTIONS,
  SERVICE_PLAN_ITEMS,
  SERVICE_PLAN_LABELS,
  ITEM_RESPONSIBLE_ROLES,
  NAG_SCHEDULE,
  BOT_SLACK_USER_ID,
  DEV_MODE,
} from "../functions/slackServiceBot/config";
import {
  v2ToV1Fields,
  sanitizeV2Item,
  type ServicePlanItemV2,
} from "../functions/slackServiceBot/configHelpers";

// ============================================================================
// Test config (mirrors hardcoded config.ts values for pure function tests)
// ============================================================================

const TEST_BOT_CONFIG = {
  servicePlanItems: SERVICE_PLAN_ITEMS as unknown as string[],
  servicePlanLabels: SERVICE_PLAN_LABELS as Record<string, string>,
  itemResponsibleRoles: ITEM_RESPONSIBLE_ROLES as Record<string, string[]>,
  teamMembers: TEAM_MEMBERS,
};

// ============================================================================
// Slack Signature Verification
// ============================================================================

describe("verifySlackSignature", () => {
  const signingSecret = "test_signing_secret_12345";
  const body = '{"type":"event_callback","event":{"type":"message"}}';

  test("accepts valid signature", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));

    // Generate a valid signature using Web Crypto API
    const encoder = new TextEncoder();
    const sigBasestring = `v0:${timestamp}:${body}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(sigBasestring)
    );
    const hashHex = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const signature = `v0=${hashHex}`;

    expect(
      await verifySlackSignature(signingSecret, signature, timestamp, body)
    ).toBe(true);
  });

  test("rejects invalid signature", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const badSignature = "v0=deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678";

    expect(
      await verifySlackSignature(signingSecret, badSignature, timestamp, body)
    ).toBe(false);
  });

  test("rejects requests older than 5 minutes", async () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 6 * 60); // 6 minutes ago

    // Even with a valid signature, old timestamps should be rejected
    const encoder = new TextEncoder();
    const sigBasestring = `v0:${oldTimestamp}:${body}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(sigBasestring)
    );
    const hashHex = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const signature = `v0=${hashHex}`;

    expect(
      await verifySlackSignature(signingSecret, signature, oldTimestamp, body)
    ).toBe(false);
  });

  test("rejects mismatched body", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const differentBody = '{"type":"different"}';

    const encoder = new TextEncoder();
    const sigBasestring = `v0:${timestamp}:${differentBody}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(sigBasestring)
    );
    const hashHex = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const signature = `v0=${hashHex}`;

    // Verify against original body (not the different one)
    expect(
      await verifySlackSignature(signingSecret, signature, timestamp, body)
    ).toBe(false);
  });
});

// ============================================================================
// Nag Urgency Selection
// ============================================================================

describe("getNagDueNow", () => {
  test("returns gentle nag on Wednesday at 11 AM ET", () => {
    // Wednesday at 11 AM
    const wednesday11am = new Date("2025-01-15T11:00:00");
    const nag = getNagDueNow(wednesday11am, NAG_SCHEDULE);
    expect(nag).not.toBeNull();
    expect(nag!.urgency).toBe("gentle");
    expect(nag!.label).toBe("Wednesday status");
  });

  test("returns direct nag on Thursday at 10 AM ET", () => {
    const thursday10am = new Date("2025-01-16T10:00:00");
    const nag = getNagDueNow(thursday10am, NAG_SCHEDULE);
    expect(nag).not.toBeNull();
    expect(nag!.urgency).toBe("direct");
  });

  test("returns urgent nag on Friday at 10 AM ET", () => {
    const friday10am = new Date("2025-01-17T10:00:00");
    const nag = getNagDueNow(friday10am, NAG_SCHEDULE);
    expect(nag).not.toBeNull();
    expect(nag!.urgency).toBe("urgent");
  });

  test("returns critical nag on Saturday at 9 AM ET", () => {
    const saturday9am = new Date("2025-01-18T09:00:00");
    const nag = getNagDueNow(saturday9am, NAG_SCHEDULE);
    expect(nag).not.toBeNull();
    expect(nag!.urgency).toBe("critical");
  });

  test("returns null when no nag is due", () => {
    // Monday at noon - no nag scheduled
    const monday = new Date("2025-01-13T12:00:00");
    expect(getNagDueNow(monday, NAG_SCHEDULE)).toBeNull();
  });

  test("returns null at wrong hour on nag day", () => {
    // Wednesday at 3 PM - wrong hour
    const wednesday3pm = new Date("2025-01-15T15:00:00");
    expect(getNagDueNow(wednesday3pm, NAG_SCHEDULE)).toBeNull();
  });

  test("returns null on Sunday", () => {
    const sunday = new Date("2025-01-19T10:00:00");
    expect(getNagDueNow(sunday, NAG_SCHEDULE)).toBeNull();
  });
});

// ============================================================================
// Missing Items Detection
// ============================================================================

describe("getMissingItems", () => {
  test("returns all items when nothing is confirmed", () => {
    const emptyState: ServicePlanState = {
      preacher: null,
      meetingLead: null,
      preachNotes: null,
      setlist: null,
      serviceFlow: null,
      announcements: null,
      serviceVideo: null,
    };
    const missing = getMissingItems(emptyState, TEST_BOT_CONFIG);
    expect(missing).toHaveLength(SERVICE_PLAN_ITEMS.length);
  });

  test("returns no items when everything is confirmed", () => {
    const fullState: ServicePlanState = {
      preacher: "Kevin Myers",
      meetingLead: "Olusegun",
      preachNotes: "Hope For The Battle — Matthew 1:18-25 (NRSV)",
      setlist: "https://open.spotify.com/playlist/abc123",
      serviceFlow: "Worship → Ministry → Welcome → Preach → Worship Close",
      announcements: "Foundations, Dinner Party Launch",
      serviceVideo: "https://dropbox.com/video.mp4",
    };
    const missing = getMissingItems(fullState, TEST_BOT_CONFIG);
    expect(missing).toHaveLength(0);
  });

  test("correctly identifies partially missing items", () => {
    const partialState: ServicePlanState = {
      preacher: "Brittany",
      meetingLead: null,
      preachNotes: null,
      setlist: "https://open.spotify.com/playlist/abc",
      serviceFlow: null,
      announcements: null,
      serviceVideo: null,
    };
    const missing = getMissingItems(partialState, TEST_BOT_CONFIG);
    expect(missing).toContain("meetingLead");
    expect(missing).toContain("preachNotes");
    expect(missing).toContain("announcements");
    expect(missing).not.toContain("preacher");
    expect(missing).not.toContain("setlist");
  });

  test("treats empty strings as missing", () => {
    const state: ServicePlanState = {
      preacher: "",
      meetingLead: "Mike Oaks",
      preachNotes: null,
      setlist: null,
      serviceFlow: null,
      announcements: null,
      serviceVideo: null,
    };
    const missing = getMissingItems(state, TEST_BOT_CONFIG);
    expect(missing).toContain("preacher");
    expect(missing).not.toContain("meetingLead");
  });
});

describe("getResponsibleMembers", () => {
  test("returns Manhattan preachers", () => {
    const members = getResponsibleMembers("preacher", "Manhattan", TEST_BOT_CONFIG);
    expect(members.length).toBeGreaterThan(0);
    members.forEach((m) => {
      expect(m.roles).toContain("preacher");
      expect(m.locations).toContain("Manhattan");
    });
  });

  test("returns Brooklyn meeting leads", () => {
    const members = getResponsibleMembers("meetingLead", "Brooklyn", TEST_BOT_CONFIG);
    expect(members.length).toBeGreaterThan(0);
    members.forEach((m) => {
      expect(m.roles.some((r) => ["ml", "preacher"].includes(r))).toBe(true);
      expect(m.locations).toContain("Brooklyn");
    });
  });

  test("returns Manhattan creative members for service video", () => {
    const members = getResponsibleMembers("serviceVideo", "Manhattan", TEST_BOT_CONFIG);
    expect(members.length).toBeGreaterThan(0);
    members.forEach((m) => {
      expect(m.roles).toContain("creative");
      expect(m.locations).toContain("Manhattan");
    });
  });

  test("returns members for service flow", () => {
    const members = getResponsibleMembers("serviceFlow", "Manhattan", TEST_BOT_CONFIG);
    expect(members.length).toBeGreaterThan(0);
    members.forEach((m) => {
      expect(m.roles.some((r) => ["production", "preacher"].includes(r))).toBe(true);
    });
  });
});

// ============================================================================
// Message Formatting
// ============================================================================

describe("buildThreadCreationMessage", () => {
  test("uses MH/BK location code and date in Leona's format", () => {
    const mhMessage = buildThreadCreationMessage("Manhattan", "2.16.25", ACTIVE_MENTIONS);
    expect(mhMessage).toContain("2.16.25 MH SUNDAY SERVICE PLANNING");

    const bkMessage = buildThreadCreationMessage("Brooklyn", "2.16.25", ACTIVE_MENTIONS);
    expect(bkMessage).toContain("2.16.25 BK SUNDAY SERVICE PLANNING");
  });

  test("mentions active members for the location", () => {
    const message = buildThreadCreationMessage("Manhattan", "2.16.25", ACTIVE_MENTIONS);
    // Should contain @mentions from ACTIVE_MENTIONS (respects DEV_MODE)
    for (const userId of ACTIVE_MENTIONS.Manhattan) {
      expect(message).toContain(`<@${userId}>`);
    }
  });

  test("DEV_MODE is disabled for production", () => {
    expect(DEV_MODE).toBe(false);
  });

  test("only mentions members configured for that location", () => {
    const manhattanMessage = buildThreadCreationMessage("Manhattan", "2.16.25", ACTIVE_MENTIONS);
    const brooklynMessage = buildThreadCreationMessage("Brooklyn", "2.16.25", ACTIVE_MENTIONS);

    // Find IDs exclusive to each location's mention list
    const manhattanOnly = ACTIVE_MENTIONS.Manhattan.filter(
      (id) => !ACTIVE_MENTIONS.Brooklyn.includes(id)
    );
    const brooklynOnly = ACTIVE_MENTIONS.Brooklyn.filter(
      (id) => !ACTIVE_MENTIONS.Manhattan.includes(id)
    );

    for (const id of manhattanOnly) {
      expect(manhattanMessage).toContain(`<@${id}>`);
      expect(brooklynMessage).not.toContain(`<@${id}>`);
    }

    for (const id of brooklynOnly) {
      expect(brooklynMessage).toContain(`<@${id}>`);
      expect(manhattanMessage).not.toContain(`<@${id}>`);
    }
  });
});

describe("buildThreadIntroMessage", () => {
  test("mentions the bot for help", () => {
    const mhIntro = buildThreadIntroMessage("Manhattan", BOT_SLACK_USER_ID);
    expect(mhIntro).toContain(`<@${BOT_SLACK_USER_ID}>`);
  });

  test("lists all checklist items", () => {
    const intro = buildThreadIntroMessage("Manhattan", BOT_SLACK_USER_ID);
    expect(intro).toContain("Preacher");
    expect(intro).toContain("Meeting Lead");
    expect(intro).toContain("Preach Notes");
    expect(intro).toContain("Setlist");
    expect(intro).toContain("Service Flow");
    expect(intro).toContain("Announcements");
    expect(intro).toContain("Service Video");
  });
});

describe("buildConfirmationMessage", () => {
  test("shows confirmed items", () => {
    const state: ServicePlanState = {
      preacher: "Kevin Myers",
      meetingLead: "Olusegun",
      preachNotes: null,
      setlist: null,
      serviceFlow: null,
      announcements: null,
      serviceVideo: null,
    };
    const message = buildConfirmationMessage(state);
    expect(message).toContain("Kevin Myers");
    expect(message).toContain("Olusegun");
    expect(message).toContain("Got it!");
  });

  test("shows all confirmed items when everything is set", () => {
    const fullState: ServicePlanState = {
      preacher: "Brittany",
      meetingLead: "Seyi",
      preachNotes: "Hope — Matthew 1:18-25 (NRSV)",
      setlist: "https://open.spotify.com/playlist/abc",
      serviceFlow: "confirmed",
      announcements: "Foundations",
      serviceVideo: "https://dropbox.com/v.mp4",
    };
    const message = buildConfirmationMessage(fullState);
    expect(message).toContain("Brittany");
    expect(message).toContain("Seyi");
    expect(message).toContain("Preach Notes");
    expect(message).toContain("Setlist: confirmed");
    expect(message).toContain("Service Flow: confirmed");
    expect(message).toContain("Announcements: confirmed");
    expect(message).toContain("Service Video");
  });

  test("shows removal confirmations", () => {
    const state: ServicePlanState = {
      preacher: null,
      meetingLead: null,
      preachNotes: null,
      setlist: null,
      serviceFlow: null,
      announcements: null,
      serviceVideo: null,
    };
    const removals = [{ role: "preacher", personName: "Kevin Myers" }];
    const message = buildConfirmationMessage(state, removals);
    expect(message).toContain("Kevin Myers");
    expect(message).toContain("removed");
    expect(message).toContain("Got it!");
  });
});

describe("buildNagMessage", () => {
  const gentleNag = NAG_SCHEDULE.find((n) => n.urgency === "gentle")!;
  const criticalNag = NAG_SCHEDULE.find((n) => n.urgency === "critical")!;

  test("shows all-clear when nothing is missing", () => {
    const fullState: ServicePlanState = {
      preacher: "Kevin Myers",
      meetingLead: "Olusegun",
      preachNotes: "Hope For The Battle — Matthew 1:18-25 (NRSV)",
      setlist: "https://open.spotify.com/playlist/abc",
      serviceFlow: "confirmed",
      announcements: "Foundations, Dinner Party",
      serviceVideo: "https://dropbox.com/video.mp4",
    };
    const message = buildNagMessage(gentleNag, "Manhattan", fullState, [], TEST_BOT_CONFIG);
    expect(message).toContain("All items confirmed");
  });

  test("gentle nag does not include @mentions", () => {
    const state: ServicePlanState = {
      preacher: null,
      meetingLead: null,
      preachNotes: null,
      setlist: null,
      serviceFlow: null,
      announcements: null,
      serviceVideo: null,
    };
    const missing = getMissingItems(state, TEST_BOT_CONFIG);
    const message = buildNagMessage(gentleNag, "Manhattan", state, missing, TEST_BOT_CONFIG);
    expect(message).toContain("Mid-week Status");
    expect(message).not.toMatch(/<@U[A-Z0-9]+>/);
  });

  test("critical nag includes @mentions for responsible people", () => {
    const state: ServicePlanState = {
      preacher: null,
      meetingLead: "Olusegun",
      preachNotes: null,
      setlist: "https://open.spotify.com/playlist/abc",
      serviceFlow: null,
      announcements: null,
      serviceVideo: null,
    };
    const missing = getMissingItems(state, TEST_BOT_CONFIG);
    const message = buildNagMessage(criticalNag, "Manhattan", state, missing, TEST_BOT_CONFIG);
    expect(message).toContain("FINAL CALL");
    expect(message).toMatch(/<@U[A-Z0-9]+>/);
  });

  test("shows confirmed items in nag", () => {
    const state: ServicePlanState = {
      preacher: "Brittany",
      meetingLead: null,
      preachNotes: null,
      setlist: null,
      serviceFlow: null,
      announcements: null,
      serviceVideo: null,
    };
    const missing = getMissingItems(state, TEST_BOT_CONFIG);
    const message = buildNagMessage(gentleNag, "Brooklyn", state, missing, TEST_BOT_CONFIG);
    expect(message).toContain("Brittany");
    expect(message).toContain("Confirmed");
  });
});

// ============================================================================
// Generated Content & PCO Sync Messages
// ============================================================================

describe("buildGeneratedContentMessage", () => {
  test("wraps preach points with correct label", () => {
    const content = "• Point 1: God is faithful\n• Point 2: Trust the process";
    const message = buildGeneratedContentMessage("preach_points", content);
    expect(message).toContain("Generated Message Points");
    expect(message).toContain(":sparkles:");
    expect(message).toContain(content);
  });

  test("wraps service flow with correct label", () => {
    const content = "1. Worship (15 min)\n2. Welcome\n3. Message";
    const message = buildGeneratedContentMessage("service_flow", content);
    expect(message).toContain("Generated Service Flow");
    expect(message).toContain(content);
  });

  test("wraps announcements with correct label", () => {
    const content = "Foundations starts next week!";
    const message = buildGeneratedContentMessage("announcements", content);
    expect(message).toContain("Generated Announcements");
    expect(message).toContain(content);
  });
});

describe("buildPcoSyncConfirmation", () => {
  test("shows success items with checkmarks", () => {
    const results = [
      { item: "Preacher", success: true, detail: "Scheduled sync for David Walker Jr." },
      { item: "Meeting Lead", success: true, detail: "Scheduled sync for Tameeka Walker" },
    ];
    const message = buildPcoSyncConfirmation(results);
    expect(message).toContain(":gear:");
    expect(message).toContain("PCO Sync Results");
    expect(message).toContain(":white_check_mark: Preacher");
    expect(message).toContain(":white_check_mark: Meeting Lead");
    expect(message).toContain("David Walker Jr.");
  });

  test("shows failed items with X marks", () => {
    const results = [
      { item: "Preacher", success: false, detail: "No preacher confirmed yet" },
      { item: "Preach Notes", success: true, detail: "Scheduled sync" },
    ];
    const message = buildPcoSyncConfirmation(results);
    expect(message).toContain(":x: Preacher");
    expect(message).toContain(":white_check_mark: Preach Notes");
  });

  test("handles empty results", () => {
    const message = buildPcoSyncConfirmation([]);
    expect(message).toContain("PCO Sync Results");
  });
});

// ============================================================================
// Intent Result Structure Validation
// ============================================================================

describe("IntentResult type validation", () => {
  test("valid info_update intent", () => {
    const result: IntentResult = {
      state: {
        preacher: "David Walker Jr.",
        meetingLead: null,
        preachNotes: null,
        setlist: null,
        serviceFlow: null,
        announcements: null,
        serviceVideo: null,
      },
      intent: "info_update",
    };
    expect(result.intent).toBe("info_update");
    expect(result.state.preacher).toBe("David Walker Jr.");
    expect(result.reply).toBeUndefined();
  });

  test("info_update with removals", () => {
    const result: IntentResult = {
      state: {
        preacher: null,
        meetingLead: null,
        preachNotes: null,
        setlist: null,
        serviceFlow: null,
        announcements: null,
        serviceVideo: null,
      },
      intent: "info_update",
      removals: [{ role: "preacher", personName: "Kevin Myers" }],
    };
    expect(result.intent).toBe("info_update");
    expect(result.state.preacher).toBeNull();
    expect(result.removals).toHaveLength(1);
    expect(result.removals![0].personName).toBe("Kevin Myers");
  });

  test("valid question intent with reply", () => {
    const result: IntentResult = {
      state: {
        preacher: "Demo Preacher",
        meetingLead: null,
        preachNotes: null,
        setlist: null,
        serviceFlow: null,
        announcements: null,
        serviceVideo: null,
      },
      intent: "question",
      reply: "Demo Preacher is confirmed as the preacher for this Sunday.",
    };
    expect(result.intent).toBe("question");
    expect(result.reply).toContain("Demo Preacher");
  });

  test("valid generate intent with request", () => {
    const result: IntentResult = {
      state: {
        preacher: null,
        meetingLead: null,
        preachNotes: null,
        setlist: null,
        serviceFlow: null,
        announcements: null,
        serviceVideo: null,
      },
      intent: "generate",
      generateRequest: {
        type: "preach_points",
        context: "Jonah and the whale — Jonah 1-4",
      },
    };
    expect(result.intent).toBe("generate");
    expect(result.generateRequest?.type).toBe("preach_points");
    expect(result.generateRequest?.context).toContain("Jonah");
  });

  test("valid pco_action intent", () => {
    const result: IntentResult = {
      state: {
        preacher: "Brittany",
        meetingLead: "Tameeka",
        preachNotes: null,
        setlist: null,
        serviceFlow: null,
        announcements: null,
        serviceVideo: null,
      },
      intent: "pco_action",
      pcoAction: { action: "sync_all" },
    };
    expect(result.intent).toBe("pco_action");
    expect(result.pcoAction?.action).toBe("sync_all");
  });

  test("all BotIntent values are valid", () => {
    const validIntents: BotIntent[] = [
      "info_update",
      "question",
      "generate",
      "pco_action",
      "irrelevant",
    ];
    // Verify all intents can be assigned
    for (const intent of validIntents) {
      const result: IntentResult = {
        state: {
          preacher: null,
          meetingLead: null,
          preachNotes: null,
          setlist: null,
          serviceFlow: null,
          announcements: null,
          serviceVideo: null,
        },
        intent,
      };
      expect(result.intent).toBe(intent);
    }
  });
});

// ============================================================================
// Config Validation
// ============================================================================

describe("config validation", () => {
  test("all team members have valid Slack user IDs", () => {
    for (const member of TEAM_MEMBERS) {
      expect(member.slackUserId).toMatch(/^U[A-Z0-9]+$/);
    }
  });

  test("all team members have at least one role", () => {
    for (const member of TEAM_MEMBERS) {
      expect(member.roles.length).toBeGreaterThan(0);
    }
  });

  test("all team members have at least one location", () => {
    for (const member of TEAM_MEMBERS) {
      expect(member.locations.length).toBeGreaterThan(0);
    }
  });

  test("nag schedule has escalating urgency", () => {
    const urgencyOrder = ["gentle", "direct", "urgent", "critical"];
    for (let i = 1; i < NAG_SCHEDULE.length; i++) {
      const prevIdx = urgencyOrder.indexOf(NAG_SCHEDULE[i - 1].urgency);
      const currIdx = urgencyOrder.indexOf(NAG_SCHEDULE[i].urgency);
      expect(currIdx).toBeGreaterThan(prevIdx);
    }
  });

  test("nag schedule days are between Wednesday and Saturday", () => {
    for (const nag of NAG_SCHEDULE) {
      expect(nag.dayOfWeek).toBeGreaterThanOrEqual(3); // Wednesday
      expect(nag.dayOfWeek).toBeLessThanOrEqual(6); // Saturday
    }
  });

  test("BOT_SLACK_USER_ID is configured", () => {
    expect(BOT_SLACK_USER_ID).toBeTruthy();
    expect(BOT_SLACK_USER_ID).toMatch(/^U[A-Z0-9]+$/);
  });
});

// ============================================================================
// V2 Config Helpers
// ============================================================================

describe("v2ToV1Fields", () => {
  test("converts V2 items to V1 fields correctly", () => {
    const items: ServicePlanItemV2[] = [
      {
        id: "preacher",
        label: "Preacher",
        responsibleRoles: ["worship_pastor"],
        actionType: "assign_role",
        pcoTeamNamePattern: "platform",
        pcoPositionName: "Preacher",
      },
      {
        id: "preachNotes",
        label: "Preach Notes",
        responsibleRoles: ["preacher"],
        actionType: "update_plan_item",
        pcoItemTitlePattern: "message|preach|sermon",
        pcoItemField: "description",
      },
    ];
    const result = v2ToV1Fields(items);
    expect(result.servicePlanItems).toEqual(["preacher", "preachNotes"]);
    expect(result.servicePlanLabels).toEqual({
      preacher: "Preacher",
      preachNotes: "Preach Notes",
    });
    expect(result.roleMappings).toEqual({
      preacher: { teamNamePattern: "platform", positionName: "Preacher" },
    });
  });

  test("handles deletion — produces correct V1 after removing an item", () => {
    const items: ServicePlanItemV2[] = [
      {
        id: "preacher",
        label: "Preacher",
        responsibleRoles: ["worship_pastor"],
        actionType: "assign_role",
        pcoTeamNamePattern: "platform",
        pcoPositionName: "Preacher",
      },
      {
        id: "meetingLead",
        label: "Meeting Lead",
        responsibleRoles: ["worship_pastor"],
        actionType: "assign_role",
        pcoTeamNamePattern: "platform",
        pcoPositionName: "Meeting Leader",
      },
      {
        id: "preachNotes",
        label: "Preach Notes",
        responsibleRoles: ["preacher"],
        actionType: "update_plan_item",
      },
    ];

    // Simulate deleting index 1 (Meeting Lead)
    const afterDelete = items.filter((_, i) => i !== 1);
    const result = v2ToV1Fields(afterDelete);
    expect(result.servicePlanItems).toEqual(["preacher", "preachNotes"]);
    expect(result.servicePlanLabels.meetingLead).toBeUndefined();
  });
});

describe("sanitizeV2Item", () => {
  test("strips extra fields from items", () => {
    const itemWithExtra = {
      id: "preacher",
      label: "Preacher",
      responsibleRoles: ["worship_pastor"],
      actionType: "assign_role" as const,
      pcoTeamNamePattern: "platform",
      pcoPositionName: "Preacher",
      extraField: "should be stripped",
      anotherExtra: 42,
    };
    const sanitized = sanitizeV2Item(itemWithExtra as any);
    expect(sanitized).toEqual({
      id: "preacher",
      label: "Preacher",
      responsibleRoles: ["worship_pastor"],
      actionType: "assign_role",
      pcoTeamNamePattern: "platform",
      pcoPositionName: "Preacher",
    });
    expect((sanitized as any).extraField).toBeUndefined();
    expect((sanitized as any).anotherExtra).toBeUndefined();
  });

  test("omits undefined optional fields", () => {
    const item = {
      id: "custom",
      label: "Custom Item",
      responsibleRoles: [],
      actionType: "none" as const,
    };
    const sanitized = sanitizeV2Item(item);
    expect(sanitized).toEqual({
      id: "custom",
      label: "Custom Item",
      responsibleRoles: [],
      actionType: "none",
    });
    expect(Object.keys(sanitized)).toEqual(["id", "label", "responsibleRoles", "actionType"]);
  });

  test("preserves all valid optional fields", () => {
    const item: ServicePlanItemV2 = {
      id: "preachNotes",
      label: "Preach Notes",
      responsibleRoles: ["preacher"],
      actionType: "update_plan_item",
      pcoItemTitlePattern: "message|preach",
      pcoItemField: "description",
      preserveSections: ["GIVING"],
      aiInstructions: "Be concise",
    };
    const sanitized = sanitizeV2Item(item);
    expect(sanitized).toEqual(item);
  });
});
