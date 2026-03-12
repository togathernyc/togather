import fs from "node:fs";
import path from "node:path";

describe("BotConfigModal birthday defaults", () => {
  const componentPath = path.join(__dirname, "..", "BotConfigModal.tsx");
  const source = fs.readFileSync(componentPath, "utf8");

  it("defaults leader reminder mode to Leaders channel", () => {
    expect(source).toContain('if (botId === "birthday" && key === "mode")');
    expect(source).toContain('nextMode === "leader_reminder"');
    expect(source).toContain('nextValues.targetChannelSlug = "leaders"');
  });

  it("defaults general chat mode to General channel", () => {
    expect(source).toContain('nextMode === "general_chat"');
    expect(source).toContain('nextValues.targetChannelSlug = "general"');
  });
});
