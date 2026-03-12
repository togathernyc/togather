import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";

async function seedGroup(t: ReturnType<typeof convexTest>) {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test-community",
      slug: "test-community",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Test Group Type",
      slug: "test-group-type",
      isActive: true,
      displayOrder: 1,
      createdAt: Date.now(),
    });
  });

  return await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Test Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

describe("groupBots birthday settings", () => {
  test("uses non-technical assignment label", async () => {
    const t = convexTest(schema, modules);

    const bots = await t.query(api.functions.groupBots.listAvailable, {});
    const birthdayBot = bots.find((bot) => bot.id === "birthday");
    const assignmentField = birthdayBot?.configFields?.find(
      (field) => field.key === "assignmentMode"
    );
    const roundRobinOption = assignmentField?.options?.find(
      (option) => option.value === "round_robin"
    );

    expect(roundRobinOption?.label).toBe("Rotate leaders");
  });

  test("defaults birthday reminder template and leaders channel", async () => {
    const t = convexTest(schema, modules);
    const groupId = await seedGroup(t);

    const config = await t.query(api.functions.groupBots.getConfig, {
      groupId,
      botId: "birthday",
    });

    expect(config.defaultConfig.mode).toBe("leader_reminder");
    expect(config.defaultConfig.targetChannelSlug).toBe("leaders");
    expect(config.defaultConfig.message).toBe(
      "🎂 It's [[birthday_names]]'s birthday today! Please wish them a happy birthday in General chat. 🎉"
    );
  });
});
