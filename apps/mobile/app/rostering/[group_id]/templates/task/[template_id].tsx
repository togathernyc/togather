import { TaskTemplateEditorScreen } from "@features/scheduling";

/**
 * Item editor for one task template — reuses the plan Event Tasks grid wired to
 * the task-template-item mutations (event templates Phase 2). Leader-gated.
 * Route: /rostering/[group_id]/templates/task/[template_id]
 */
export default function TaskTemplateEditorPage() {
  return <TaskTemplateEditorScreen />;
}
