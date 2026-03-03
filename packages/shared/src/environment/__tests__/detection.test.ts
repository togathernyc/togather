import { detectEnvironment } from "../detection";

describe("detectEnvironment", () => {
  it("defaults to staging when NODE_ENV is production but APP_ENV is unset", () => {
    // This simulates common staging deployments where Node runs with NODE_ENV=production
    // for optimizations, but the deployment is still "staging" for data/notifications.
    //
    // SAFETY: We should only return "production" when explicitly configured.
    expect(
      detectEnvironment({
        appEnv: undefined,
        nodeEnv: "production",
      })
    ).toBe("staging");
  });
});

