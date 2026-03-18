import { afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "../test.setup";
import { internal } from "../_generated/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendBatchPushNotifications", () => {
  test("always sets mutableContent even without an image", async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "ticket-1", status: "ok" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(
      internal.functions.notifications.internal.sendBatchPushNotifications,
      {
        notifications: [
          {
            token: "ExponentPushToken[mutable-content-test]",
            title: "Test Sender",
            body: "Test Group: General\nMessage body",
            data: {
              type: "new_message",
              groupId: "group_123",
              channelId: "channel_123",
            },
          },
        ],
      }
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody[0].mutableContent).toBe(true);
    expect(requestBody[0].richContent).toBeUndefined();
    expect(requestBody[0].data.type).toBe("new_message");
  });
});
