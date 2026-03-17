"use client";

/**
 * Task Short Link Route Component
 *
 * Handles CLIENT-SIDE routing for shared task links (togather.nyc/t/[shortId]).
 * Legacy tool links now redirect to /r/[shortId] during migration.
 */

import TaskPageClient from "./TaskPageClient";

export default function ToolPage() {
  return <TaskPageClient />;
}
