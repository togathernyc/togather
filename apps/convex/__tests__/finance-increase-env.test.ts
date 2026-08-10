/**
 * Which Increase environment this deployment talks to — and the fact that it
 * can never be guessed.
 *
 * Two landmines this suite exists to keep closed (issue #744, runbook §5.1):
 *
 * (a) `getIncreaseBaseUrl()` used to default to `https://api.increase.com` —
 *     PRODUCTION — when `INCREASE_API_BASE_URL` was unset. A deployment that
 *     forgot the variable silently pointed at the real banking API.
 *
 * (b) `createEntity` used to choose between a FABRICATED beneficial owner
 *     (with a fake SSN) and the real bank-partner exemption by asking whether
 *     the base URL happened to contain the substring `"sandbox"`. A typo, a
 *     trailing slash, or a proxy host in front of Increase would submit
 *     fabricated identity data to the live API for a real church.
 *
 * Both are now decided by an explicit `INCREASE_ENVIRONMENT` enum. These tests
 * stub the TRANSPORT (`fetch`) and let the real client run, so they assert the
 * host actually requested and the literal body actually sent.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-increase-env.test.ts
 */

import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { createEntity, getEntity } from "../lib/finance/increase";

interface CapturedRequest {
  url: string;
  body: any;
}

let requests: CapturedRequest[];
const savedEnv = { ...process.env };

const ENTITY_INPUT = {
  legalName: "First Church",
  ein: "12-3456789",
  address: {
    addressLine1: "1 Church St",
    city: "New York",
    state: "NY",
    zipCode: "10001",
  },
  idempotencyKey: "idem_entity_1",
};

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      return new Response(
        JSON.stringify({ id: "entity_abc123", status: "active" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  process.env.INCREASE_API_KEY = "test-increase-key";
  delete process.env.INCREASE_API_BASE_URL;
  delete process.env.INCREASE_ENVIRONMENT;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

describe("INCREASE_ENVIRONMENT fails closed", () => {
  test("an unset environment refuses to make any request", async () => {
    await expect(getEntity("entity_1")).rejects.toThrow(/INCREASE_ENVIRONMENT/);
    expect(requests).toHaveLength(0);
  });

  test("a blank environment refuses to make any request", async () => {
    process.env.INCREASE_ENVIRONMENT = "   ";

    await expect(getEntity("entity_1")).rejects.toThrow(/INCREASE_ENVIRONMENT/);
    expect(requests).toHaveLength(0);
  });

  test("an unrecognized environment refuses to make any request", async () => {
    process.env.INCREASE_ENVIRONMENT = "prod";

    await expect(getEntity("entity_1")).rejects.toThrow(/INCREASE_ENVIRONMENT/);
    expect(requests).toHaveLength(0);
  });

  test("an unset environment refuses even with an explicit base URL", async () => {
    // The base URL alone never re-enables the compliance branch: the
    // environment is the one declaration, and it is not optional.
    process.env.INCREASE_API_BASE_URL = "https://sandbox.increase.com";

    await expect(createEntity(ENTITY_INPUT)).rejects.toThrow(
      /INCREASE_ENVIRONMENT/,
    );
    expect(requests).toHaveLength(0);
  });
});

describe("the environment picks the host", () => {
  test("sandbox targets the sandbox host", async () => {
    process.env.INCREASE_ENVIRONMENT = "sandbox";

    await getEntity("entity_1");

    expect(requests[0].url).toBe("https://sandbox.increase.com/entities/entity_1");
  });

  test("production targets the production host", async () => {
    process.env.INCREASE_ENVIRONMENT = "production";

    await getEntity("entity_1");

    expect(requests[0].url).toBe("https://api.increase.com/entities/entity_1");
  });

  test("an explicit base URL overrides the host the environment implies", async () => {
    process.env.INCREASE_ENVIRONMENT = "sandbox";
    process.env.INCREASE_API_BASE_URL = "https://increase.test.local";

    await getEntity("entity_1");

    expect(requests[0].url).toBe("https://increase.test.local/entities/entity_1");
  });

  test("a blank base URL is treated as unset, not as an empty host", async () => {
    process.env.INCREASE_ENVIRONMENT = "production";
    process.env.INCREASE_API_BASE_URL = "  ";

    await getEntity("entity_1");

    expect(requests[0].url).toBe("https://api.increase.com/entities/entity_1");
  });
});

describe("the environment picks the beneficial-ownership path", () => {
  test("sandbox submits the fabricated test owner", async () => {
    process.env.INCREASE_ENVIRONMENT = "sandbox";

    await createEntity(ENTITY_INPUT);

    const corporation = requests[0].body.corporation;
    expect(corporation.beneficial_owners).toHaveLength(1);
    expect(corporation.beneficial_ownership_exemption_reason).toBeUndefined();
  });

  test("production submits the exemption, never a fabricated owner", async () => {
    process.env.INCREASE_ENVIRONMENT = "production";

    await createEntity(ENTITY_INPUT);

    const corporation = requests[0].body.corporation;
    expect(corporation.beneficial_ownership_exemption_reason).toBe("other");
    expect(corporation.beneficial_owners).toBeUndefined();
  });

  test("a host that says 'sandbox' cannot fabricate an owner in production", async () => {
    // Landmine (b) in its original direction: the URL substring must no
    // longer have any say over what identity data we submit.
    process.env.INCREASE_ENVIRONMENT = "production";
    process.env.INCREASE_API_BASE_URL = "https://sandbox.increase.com";

    await createEntity(ENTITY_INPUT);

    const corporation = requests[0].body.corporation;
    expect(corporation.beneficial_ownership_exemption_reason).toBe("other");
    expect(corporation.beneficial_owners).toBeUndefined();
  });

  test("a sandbox host that doesn't spell 'sandbox' still uses the sandbox path", async () => {
    // The mirror case: a proxy or a typo'd host used to flip us onto the
    // production compliance path without anyone noticing.
    process.env.INCREASE_ENVIRONMENT = "sandbox";
    process.env.INCREASE_API_BASE_URL = "https://increase-proxy.test.local";

    await createEntity(ENTITY_INPUT);

    const corporation = requests[0].body.corporation;
    expect(corporation.beneficial_owners).toHaveLength(1);
    expect(corporation.beneficial_ownership_exemption_reason).toBeUndefined();
  });
});
