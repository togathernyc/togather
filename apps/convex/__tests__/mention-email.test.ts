import { describe, it, expect } from "vitest";
import { mentionEmail } from "../lib/notifications/emailTemplates";

describe("mentionEmail", () => {
  it("renders sender, group, and message preview", () => {
    const html = mentionEmail({
      senderName: "Alice Sender",
      groupName: "Demo Group",
      messagePreview: "Hey @you can you take a look?",
    });

    expect(html).toContain("Alice Sender");
    expect(html).toContain("Demo Group");
    expect(html).toContain("Hey @you can you take a look?");
    expect(html).toContain("Someone mentioned you in Togather");
  });

  it("includes first-name greeting when provided", () => {
    const html = mentionEmail({
      senderName: "Alice",
      groupName: "Demo Group",
      messagePreview: "Hello",
      firstName: "Jordan",
    });

    expect(html).toContain("Hi Jordan,");
  });

  it("escapes HTML in user-provided content", () => {
    const html = mentionEmail({
      senderName: '<img src=x onerror="alert(1)">',
      groupName: "<script>alert(1)</script>",
      messagePreview: '"quoted" & <b>bold</b>',
      firstName: 'Jo "J"',
    });

    // These strings should be escaped rather than interpreted as HTML
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain('Hi Jo &quot;J&quot;,');
  });
});

