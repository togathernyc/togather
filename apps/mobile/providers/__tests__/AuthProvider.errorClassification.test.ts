import { classifyProfileFetchError } from "../AuthProvider";

describe("classifyProfileFetchError", () => {
  it("treats offline NetInfo state as network_error", () => {
    const result = classifyProfileFetchError(
      new Error("Some random error"),
      { isConnected: false, isInternetReachable: false }
    );

    expect(result).toBe("network_error");
  });

  it("treats fetch/network failures as network_error", () => {
    const result = classifyProfileFetchError(
      new Error("TypeError: Failed to fetch"),
      { isConnected: true, isInternetReachable: true }
    );

    expect(result).toBe("network_error");
  });

  it("treats invalid auth errors as not_found", () => {
    const result = classifyProfileFetchError(
      new Error("Not authenticated: invalid token"),
      { isConnected: true, isInternetReachable: true }
    );

    expect(result).toBe("not_found");
  });

  it("defaults unknown connected failures to network_error to preserve session", () => {
    const result = classifyProfileFetchError(
      new Error("Unexpected server crash"),
      { isConnected: true, isInternetReachable: true }
    );

    expect(result).toBe("network_error");
  });
});
