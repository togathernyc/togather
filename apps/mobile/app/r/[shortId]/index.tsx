"use client";

/**
 * Resource/Tool Short Link Route Component
 *
 * Handles CLIENT-SIDE routing for shared resource/tool links (togather.nyc/r/[shortId]).
 */
import ToolPageClient from "../../t/[shortId]/ToolPageClient";

export default function ResourcePage() {
  return <ToolPageClient />;
}
