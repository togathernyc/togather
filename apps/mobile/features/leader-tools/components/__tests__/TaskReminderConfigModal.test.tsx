import fs from "node:fs";
import path from "node:path";

describe("TaskReminderConfigModal keyboard UX safeguards", () => {
  const componentPath = path.join(__dirname, "..", "TaskReminderConfigModal.tsx");
  const source = fs.readFileSync(componentPath, "utf8");

  it("keeps keyboard dismiss mode on the main config ScrollView", () => {
    expect(source).toContain('testID="task-reminder-config-scroll"');
    expect(source).toContain(
      'keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}'
    );
  });

  it("keeps backdrop-driven keyboard dismiss for task editor", () => {
    expect(source).toContain('testID="task-editor-backdrop"');
    expect(source).toContain("onPress={Keyboard.dismiss}");
    expect(source).toContain('testID="task-editor-scroll"');
  });
});
