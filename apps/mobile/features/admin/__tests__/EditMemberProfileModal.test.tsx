import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import {
  EditMemberProfileModal,
  type EditableMemberProfile,
} from "@features/admin/components/EditMemberProfileModal";

/**
 * Tests for the ADR-034 admin profile edit form.
 *
 * The three behaviours worth guarding are the ones that silently lose data
 * when they regress: dirty-field-only submission, surviving a parent rerender,
 * and the date-of-birth conversion.
 */

const MEMBER: EditableMemberProfile = {
  firstName: "Rafel",
  lastName: "Ortiz",
  email: "rafael@test.com",
  phone: "+12025550123",
  dateOfBirth: Date.UTC(1990, 3, 12),
};

function props(overrides: Partial<React.ComponentProps<typeof EditMemberProfileModal>> = {}) {
  return {
    visible: true,
    member: MEMBER,
    lockedReason: null,
    onClose: jest.fn(),
    onSave: jest.fn().mockResolvedValue(undefined),
    isSaving: false,
    ...overrides,
  };
}

describe("EditMemberProfileModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("pre-fills every field from the member record", () => {
    render(<EditMemberProfileModal {...props()} />);

    expect(screen.getByDisplayValue("Rafel")).toBeTruthy();
    expect(screen.getByDisplayValue("Ortiz")).toBeTruthy();
    expect(screen.getByDisplayValue("rafael@test.com")).toBeTruthy();
    expect(screen.getByDisplayValue("+12025550123")).toBeTruthy();
  });

  it("submits ONLY the field that changed", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<EditMemberProfileModal {...props({ onSave })} />);

    fireEvent.changeText(screen.getByDisplayValue("Rafel"), "Rafael");
    fireEvent.press(screen.getByText("Save Changes"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Crucially: no `lastName`, `email`, `phone` or `dateOfBirth` keys at all.
    // Sending them would let this stale form revert a concurrent edit by
    // another admin, and the audit trail would record that as deliberate.
    expect(onSave).toHaveBeenCalledWith({ firstName: "Rafael" });
  });

  it("cannot be saved when nothing was touched", () => {
    const onSave = jest.fn();
    render(<EditMemberProfileModal {...props({ onSave })} />);

    fireEvent.press(screen.getByText("Save Changes"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not treat a reason alone as an edit", () => {
    const onSave = jest.fn();
    render(<EditMemberProfileModal {...props({ onSave })} />);

    fireEvent.changeText(
      screen.getByPlaceholderText("e.g. Corrected from Gold Card"),
      "just a note",
    );
    fireEvent.press(screen.getByText("Save Changes"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps typed edits when the parent rerenders with a fresh member object", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <EditMemberProfileModal {...props({ onSave })} />,
    );

    fireEvent.changeText(screen.getByDisplayValue("Rafel"), "Rafael");

    // A rerender with an equal-but-not-identical member object is guaranteed
    // the moment saving starts. If the reset effect depended on `member`
    // identity, everything the admin typed would be silently replaced here.
    rerender(
      <EditMemberProfileModal
        {...props({ onSave })}
        member={{ ...MEMBER }}
        isSaving
      />,
    );

    expect(screen.getByDisplayValue("Rafael")).toBeTruthy();
    expect(screen.queryByDisplayValue("Rafel")).toBeNull();
  });

  it("re-prefills when reopened after being closed", () => {
    const { rerender } = render(<EditMemberProfileModal {...props()} />);

    fireEvent.changeText(screen.getByDisplayValue("Rafel"), "Typo");
    rerender(<EditMemberProfileModal {...props({ visible: false })} />);
    rerender(<EditMemberProfileModal {...props()} />);

    // Reopening is a fresh edit, so the stored value comes back.
    expect(screen.getByDisplayValue("Rafel")).toBeTruthy();
  });

  describe("locked contact fields", () => {
    const locked = { lockedReason: "this member has verified their phone number" };

    it("explains why phone and email are locked", () => {
      render(<EditMemberProfileModal {...props(locked)} />);
      expect(
        screen.getByText(/this member has verified their phone number/),
      ).toBeTruthy();
    });

    it("makes the contact inputs read-only", () => {
      render(<EditMemberProfileModal {...props(locked)} />);
      expect(screen.getByDisplayValue("rafael@test.com").props.editable).toBe(
        false,
      );
      expect(screen.getByDisplayValue("+12025550123").props.editable).toBe(
        false,
      );
    });

    it("never submits locked contact fields, so a name edit still goes through", async () => {
      const onSave = jest.fn().mockResolvedValue(undefined);
      render(<EditMemberProfileModal {...props({ ...locked, onSave })} />);

      fireEvent.changeText(screen.getByDisplayValue("Rafel"), "Rafael");
      fireEvent.press(screen.getByText("Save Changes"));

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      // A legacy-format or today-invalid stored value is never resubmitted, so
      // it cannot trip a guard meant for real contact edits.
      expect(onSave).toHaveBeenCalledWith({ firstName: "Rafael" });
    });
  });

  describe("phone", () => {
    it("does not require a phone for a member who has none on record", async () => {
      const onSave = jest.fn().mockResolvedValue(undefined);
      render(
        <EditMemberProfileModal
          {...props({ onSave })}
          member={{ ...MEMBER, phone: null }}
        />,
      );

      fireEvent.changeText(screen.getByDisplayValue("Rafel"), "Rafael");
      fireEvent.press(screen.getByText("Save Changes"));

      await waitFor(() => expect(onSave).toHaveBeenCalledWith({ firstName: "Rafael" }));
    });

    it("refuses to submit removal of an existing phone", () => {
      const onSave = jest.fn();
      render(<EditMemberProfileModal {...props({ onSave })} />);

      fireEvent.changeText(screen.getByDisplayValue("+12025550123"), "");
      fireEvent.press(screen.getByText("Save Changes"));

      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe("date of birth", () => {
    it("clears the date of birth when the clear action is used", async () => {
      const onSave = jest.fn().mockResolvedValue(undefined);
      render(<EditMemberProfileModal {...props({ onSave })} />);

      // The shared DatePicker only emits selected Dates on native — without
      // this affordance, clearing would be reachable on web only.
      fireEvent.press(screen.getByText("Clear date of birth"));
      fireEvent.press(screen.getByText("Save Changes"));

      await waitFor(() => expect(onSave).toHaveBeenCalledWith({ dateOfBirth: null }));
    });

    it("hides the clear action when there is no date to clear", () => {
      render(
        <EditMemberProfileModal
          {...props()}
          member={{ ...MEMBER, dateOfBirth: null }}
        />,
      );
      expect(screen.queryByText("Clear date of birth")).toBeNull();
    });

    it("does not report an unchanged birthday as an edit", () => {
      const onSave = jest.fn();
      render(<EditMemberProfileModal {...props({ onSave })} />);

      // The stored value is UTC midnight; the picker holds local midnight of
      // the same calendar day. Reading either with the other's getters would
      // shift the day and make an untouched birthday look edited — which,
      // since the form submits dirty fields only, would then write a spurious
      // audit row on every unrelated save.
      fireEvent.press(screen.getByText("Save Changes"));
      expect(onSave).not.toHaveBeenCalled();
    });

    it("treats the Unix epoch as a real date, not an empty one", () => {
      render(
        <EditMemberProfileModal
          {...props()}
          member={{ ...MEMBER, dateOfBirth: 0 }}
        />,
      );
      // Timestamp 0 is 1970-01-01. A truthiness check anywhere in the chain
      // would hide the clear action, proving the date had been read as empty.
      expect(screen.getByText("Clear date of birth")).toBeTruthy();
    });
  });
});
