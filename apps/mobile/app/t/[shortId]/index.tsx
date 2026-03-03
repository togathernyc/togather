"use client";

/**
 * Tool Page Route Component
 *
 * Handles CLIENT-SIDE routing for shared tool links (togather.nyc/t/[shortId]).
 * Resolves the shortId to a tool type (Run Sheet or Resource) and renders accordingly.
 */

import ToolPageClient from "./ToolPageClient";

export default function ToolPage() {
  return <ToolPageClient />;
}
