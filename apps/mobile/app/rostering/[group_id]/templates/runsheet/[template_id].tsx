import { RunSheetTemplateEditorScreen } from "@features/scheduling";

/**
 * Item editor for one run-sheet template — reuses the run sheet editor grid
 * wired to the run-sheet-template-item mutations (event templates Phase 2).
 * Leader-gated. Route: /rostering/[group_id]/templates/runsheet/[template_id]
 */
export default function RunSheetTemplateEditorPage() {
  return <RunSheetTemplateEditorScreen />;
}
