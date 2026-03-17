import { extractToolShortIds, stripToolLinksFromText } from "../eventLinkUtils";

describe("eventLinkUtils shared short links", () => {
  it("extracts short ids from both /t and /r links", () => {
    const text = "Check https://togather.nyc/t/task123 and https://togather.nyc/r/tool456";
    expect(extractToolShortIds(text)).toEqual(["task123", "tool456"]);
  });

  it("strips both /t and /r links from message text", () => {
    const text = "Task https://togather.nyc/t/task123 Resource https://togather.nyc/r/tool456";
    expect(stripToolLinksFromText(text)).toBe("Task  Resource");
  });
});
