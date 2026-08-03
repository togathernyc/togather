/**
 * The finance-gate boundary's two load-bearing claims, which nothing else
 * checks: an access denial is CAUGHT and shown as an answer, and anything else
 * is RE-THROWN so a real failure still reaches the app's root ErrorBoundary
 * instead of being disguised as "you don't have access".
 *
 * Both are asserted through a real render, because both live in
 * `getDerivedStateFromError` — React's own machinery decides whether a throw
 * from there propagates, and a direct call to the static method would prove
 * nothing about what the user actually sees.
 */
import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import {
  CommunityFinanceAccessBoundary,
  isCommunityFinanceAccessDenial,
} from "../CommunityFinanceAccess";

/** Convex re-throws a query's error during render; this stands in for that. */
function Thrower({ error }: { error: unknown }): React.ReactElement {
  throw error;
}

// The boundary logs the caught error through React's console.error path.
const consoleError = jest
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

afterAll(() => consoleError.mockRestore());

describe("isCommunityFinanceAccessDenial", () => {
  test("recognises every wording the backend refuses with", () => {
    for (const message of [
      "You need financial-controls access for this community — ask your community's primary admin to grant it to you",
      "You need financial-controls access for this community to see who holds it",
      "You need financial-controls access for this community to see who it can be given to",
    ]) {
      expect(isCommunityFinanceAccessDenial(new ConvexError(message))).toBe(
        true,
      );
    }
  });

  test("does not claim an ordinary failure is a permissions problem", () => {
    expect(isCommunityFinanceAccessDenial(new Error("Network request failed"))).toBe(
      false,
    );
    expect(isCommunityFinanceAccessDenial(undefined)).toBe(false);
  });
});

describe("CommunityFinanceAccessBoundary", () => {
  test("a denial renders the fallback instead of crashing", () => {
    const { getByText, queryByText } = render(
      <CommunityFinanceAccessBoundary
        fallback={<Text>Ask your primary admin</Text>}
      >
        <Thrower
          error={
            new ConvexError(
              "You need financial-controls access for this community — ask your community's primary admin to grant it to you",
            )
          }
        />
      </CommunityFinanceAccessBoundary>,
    );

    expect(getByText("Ask your primary admin")).toBeTruthy();
    expect(queryByText("unreachable")).toBeNull();
  });

  test("a NON-access error is re-thrown, not swallowed", () => {
    // The failure mode this test exists for: a boundary that caught everything
    // would report every backend outage as a permissions answer, and the bug
    // would never be visible to anyone.
    expect(() =>
      render(
        <CommunityFinanceAccessBoundary fallback={<Text>Denied</Text>}>
          <Thrower error={new Error("Network request failed")} />
        </CommunityFinanceAccessBoundary>,
      ),
    ).toThrow(/Network request failed/);
  });

  test("children render untouched when nothing throws", () => {
    const { getByText } = render(
      <CommunityFinanceAccessBoundary fallback={<Text>Denied</Text>}>
        <Text>The controls</Text>
      </CommunityFinanceAccessBoundary>,
    );
    expect(getByText("The controls")).toBeTruthy();
  });
});
