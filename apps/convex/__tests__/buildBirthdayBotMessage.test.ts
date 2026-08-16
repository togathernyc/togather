/**
 * Birthday Bot message-building tests.
 *
 * `buildBirthdayBotMessage` is the pure core of the birthday bot: it turns the
 * configured template into the posted message plus the set of users to
 * @mention. The two modes address different people, so they mention different
 * people — that split is what these tests pin down.
 *
 * Run with: cd apps/convex && pnpm test __tests__/buildBirthdayBotMessage.test.ts
 */

import { expect, test, describe } from "vitest";
import { buildBirthdayBotMessage } from "../functions/scheduledJobs";

import type { Id } from "../_generated/dataModel";

const userId = (n: string) => n as Id<"users">;

const DEFAULT_TEMPLATE =
  "🎂 Hey [[leader_name]], it's your turn to wish [[birthday_names]] a happy birthday in General chat! 🎉";

const LEADER = { userId: userId("leader_1"), displayName: "Maria Okonkwo" };

describe("general_chat mode", () => {
  test("@mentions the birthday person by full name", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: "Happy birthday [[birthday_names]]! 🎉",
      mode: "general_chat",
      birthdays: [
        { userId: userId("u1"), firstName: "Tadala", lastName: "Jumbe" },
      ],
      targetLeader: null,
      groupName: "Young Adults",
      communityName: "Togather NYC",
    });

    expect(message).toBe("Happy birthday @[Tadala Jumbe]! 🎉");
    expect(mentionedUserIds).toEqual([userId("u1")]);
  });

  test("mentions every birthday person when several share a day", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: "Happy birthday [[birthday_names]]!",
      mode: "general_chat",
      birthdays: [
        { userId: userId("u1"), firstName: "Tadala", lastName: "Jumbe" },
        { userId: userId("u2"), firstName: "Joshua", lastName: "Irby-Shabazz" },
      ],
      targetLeader: null,
      groupName: "Young Adults",
      communityName: "Togather NYC",
    });

    expect(message).toBe(
      "Happy birthday @[Tadala Jumbe], @[Joshua Irby-Shabazz]!",
    );
    expect(mentionedUserIds).toEqual([userId("u1"), userId("u2")]);
  });

  test("does not mention the leader when posting to general", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: DEFAULT_TEMPLATE,
      mode: "general_chat",
      birthdays: [
        { userId: userId("u1"), firstName: "Tadala", lastName: "Jumbe" },
      ],
      targetLeader: LEADER,
      groupName: "Young Adults",
      communityName: "Togather NYC",
    });

    expect(message).toContain("@[Tadala Jumbe]");
    expect(message).not.toContain("@[Maria Okonkwo]");
    expect(mentionedUserIds).toEqual([userId("u1")]);
  });
});

describe("leader_reminder mode", () => {
  test("@mentions the leader and names the birthday person in full", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: DEFAULT_TEMPLATE,
      mode: "leader_reminder",
      birthdays: [
        { userId: userId("u1"), firstName: "Tadala", lastName: "Jumbe" },
      ],
      targetLeader: LEADER,
      groupName: "Young Adults",
      communityName: "Togather NYC",
    });

    expect(message).toBe(
      "🎂 Hey @[Maria Okonkwo], it's your turn to wish Tadala Jumbe a happy birthday in General chat! 🎉",
    );
    expect(mentionedUserIds).toEqual([userId("leader_1")]);
  });

  test("never mentions the birthday person — the nudge is private", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: DEFAULT_TEMPLATE,
      mode: "leader_reminder",
      birthdays: [
        { userId: userId("u1"), firstName: "Tadala", lastName: "Jumbe" },
      ],
      targetLeader: LEADER,
      groupName: "Young Adults",
      communityName: "Togather NYC",
    });

    expect(message).not.toContain("@[Tadala Jumbe]");
    expect(mentionedUserIds).not.toContain(userId("u1"));
  });

  test("falls back to 'leader' with no mention when the group has no leaders", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: DEFAULT_TEMPLATE,
      mode: "leader_reminder",
      birthdays: [
        { userId: userId("u1"), firstName: "Tadala", lastName: "Jumbe" },
      ],
      targetLeader: null,
      groupName: "Young Adults",
      communityName: "Togather NYC",
    });

    expect(message).toContain("Hey leader,");
    expect(message).not.toContain("@[");
    expect(mentionedUserIds).toEqual([]);
  });
});

describe("name handling", () => {
  test("uses the first name alone when there is no last name", () => {
    const { message } = buildBirthdayBotMessage({
      template: "[[birthday_names]]",
      mode: "leader_reminder",
      birthdays: [{ userId: userId("u1"), firstName: "Tadala" }],
      targetLeader: LEADER,
      groupName: "G",
      communityName: "C",
    });

    expect(message).toBe("Tadala");
  });

  test("falls back to 'a member' and skips the mention for a nameless user", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: "Happy birthday [[birthday_names]]!",
      mode: "general_chat",
      birthdays: [{ userId: userId("u1") }],
      targetLeader: null,
      groupName: "G",
      communityName: "C",
    });

    expect(message).toBe("Happy birthday a member!");
    expect(mentionedUserIds).toEqual([]);
  });

  test("a '$' in a name is inserted literally, not as a capture reference", () => {
    const { message } = buildBirthdayBotMessage({
      template: "[[birthday_names]]",
      mode: "leader_reminder",
      birthdays: [{ userId: userId("u1"), firstName: "A$AP", lastName: "Rocky" }],
      targetLeader: LEADER,
      groupName: "G",
      communityName: "C",
    });

    expect(message).toBe("A$AP Rocky");
  });
});

describe("mention metadata never outruns the visible markup", () => {
  test("no birthday mention ids when the template drops [[birthday_names]]", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: "🎂 It's a birthday in [[group_name]] today!",
      mode: "general_chat",
      birthdays: [
        { userId: userId("u1"), firstName: "Tadala", lastName: "Jumbe" },
      ],
      targetLeader: null,
      groupName: "Young Adults",
      communityName: "Togather NYC",
    });

    // Attaching the id anyway would send a "you were mentioned" push and email
    // for a message that mentions nobody.
    expect(message).not.toContain("@[");
    expect(mentionedUserIds).toEqual([]);
  });

  test("no leader mention id when the template drops [[leader_name]]", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: "Someone should wish [[birthday_names]] a happy birthday!",
      mode: "leader_reminder",
      birthdays: [
        { userId: userId("u1"), firstName: "Tadala", lastName: "Jumbe" },
      ],
      targetLeader: LEADER,
      groupName: "Young Adults",
      communityName: "Togather NYC",
    });

    expect(message).not.toContain("@[");
    expect(mentionedUserIds).toEqual([]);
  });

  test("a name containing brackets cannot forge a second mention", () => {
    const { message, mentionedUserIds } = buildBirthdayBotMessage({
      template: "Happy birthday [[birthday_names]]!",
      mode: "general_chat",
      birthdays: [
        {
          userId: userId("u1"),
          firstName: "Bob]",
          lastName: "hi @[Pastor Dave",
        },
      ],
      targetLeader: null,
      groupName: "G",
      communityName: "C",
    });

    // Exactly one mention span, and it is the real one.
    expect(message.match(/@\[/g)).toHaveLength(1);
    expect(message).toBe("Happy birthday @[Bob hi @Pastor Dave]!");
    expect(mentionedUserIds).toEqual([userId("u1")]);
  });
});

describe("placeholders", () => {
  test("fills group and community names", () => {
    const { message } = buildBirthdayBotMessage({
      template: "[[group_name]] @ [[community_name]]",
      mode: "general_chat",
      birthdays: [{ userId: userId("u1"), firstName: "Tadala" }],
      targetLeader: null,
      groupName: "Young Adults",
      communityName: "Togather NYC",
    });

    expect(message).toBe("Young Adults @ Togather NYC");
  });

  test("replaces a placeholder used more than once", () => {
    const { message } = buildBirthdayBotMessage({
      template: "[[birthday_names]] — happy birthday [[birthday_names]]!",
      mode: "leader_reminder",
      birthdays: [
        { userId: userId("u1"), firstName: "Tadala", lastName: "Jumbe" },
      ],
      targetLeader: LEADER,
      groupName: "G",
      communityName: "C",
    });

    expect(message).toBe("Tadala Jumbe — happy birthday Tadala Jumbe!");
  });
});
