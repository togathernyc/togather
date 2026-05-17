/**
 * Tests for the starter-role keyword map (ADR-023).
 */

import { describe, it, expect } from "vitest";
import {
  suggestStarterRolesForName,
  DEFAULT_STARTER_ROLES,
} from "../../functions/scheduling/starterRoles";

describe("suggestStarterRolesForName", () => {
  it("maps worship/band/music channels to a music role set", () => {
    for (const name of ["Worship Team", "House Band", "Music Crew"]) {
      const names = suggestStarterRolesForName(name).map((r) => r.name);
      expect(names).toContain("Vocals");
      expect(names).toContain("Drums");
      expect(names).toContain("Keys");
      expect(names).toContain("Guitar");
      expect(names).toContain("Bass");
    }
  });

  it("maps tech/production channels to an AV role set", () => {
    const names = suggestStarterRolesForName("Production Team").map(
      (r) => r.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(["Sound", "Lights", "ProPresenter", "Camera"]),
    );
  });

  it("maps usher/host/greet channels to a hospitality role set", () => {
    const names = suggestStarterRolesForName("Greeters & Ushers").map(
      (r) => r.name,
    );
    expect(names).toEqual(expect.arrayContaining(["Greeter", "Usher"]));
  });

  it("maps kids/children channels to a kids role set", () => {
    const names = suggestStarterRolesForName("Kids Ministry").map(
      (r) => r.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(["Check-in", "Classroom Lead", "Helper"]),
    );
  });

  it("is case-insensitive", () => {
    expect(suggestStarterRolesForName("WORSHIP")).toEqual(
      suggestStarterRolesForName("worship"),
    );
  });

  it("returns the default set when no keyword matches", () => {
    expect(suggestStarterRolesForName("Random Channel")).toEqual(
      DEFAULT_STARTER_ROLES,
    );
    expect(suggestStarterRolesForName("")).toEqual(DEFAULT_STARTER_ROLES);
  });
});
