/**
 * Tests for eventModeStore — serving mode on/off plus the "preview plan" a
 * volunteer opens early from My Schedule.
 */
import { useEventModeStore } from "../eventModeStore";

describe("eventModeStore", () => {
  beforeEach(() => {
    useEventModeStore.setState({
      isServingMode: false,
      autoEnterBlocked: false,
      previewPlanId: null,
    });
  });

  it("starts out of serving mode with no preview plan", () => {
    const s = useEventModeStore.getState();
    expect(s.isServingMode).toBe(false);
    expect(s.previewPlanId).toBeNull();
  });

  it("enterPreview scopes serving mode to a single plan", () => {
    useEventModeStore.getState().enterPreview("plan_next_week");
    const s = useEventModeStore.getState();
    expect(s.isServingMode).toBe(true);
    expect(s.previewPlanId).toBe("plan_next_week");
  });

  it("enter() clears a preview — normal (auto-)entry spans today's plans", () => {
    useEventModeStore.getState().enterPreview("plan_next_week");
    useEventModeStore.getState().enter();
    const s = useEventModeStore.getState();
    expect(s.isServingMode).toBe(true);
    expect(s.previewPlanId).toBeNull();
  });

  it("exit() leaves serving mode, clears the preview and blocks auto-enter", () => {
    useEventModeStore.getState().enterPreview("plan_next_week");
    useEventModeStore.getState().exit();
    const s = useEventModeStore.getState();
    expect(s.isServingMode).toBe(false);
    expect(s.previewPlanId).toBeNull();
    expect(s.autoEnterBlocked).toBe(true);
  });

  it("switching preview plans replaces the scope rather than accumulating", () => {
    useEventModeStore.getState().enterPreview("plan_a");
    useEventModeStore.getState().enterPreview("plan_b");
    expect(useEventModeStore.getState().previewPlanId).toBe("plan_b");
  });
});
