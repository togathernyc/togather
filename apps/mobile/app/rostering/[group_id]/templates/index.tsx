import { TemplatesLibraryScreen } from "@features/scheduling";

/**
 * Per-group event templates library — task templates + run-sheet templates
 * (event templates Phase 2). Leader-gated inside the screen.
 * Route: /rostering/[group_id]/templates
 */
export default function TemplatesLibraryPage() {
  return <TemplatesLibraryScreen />;
}
