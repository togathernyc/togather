/**
 * TemplatesLibraryScreen
 *
 * The per-GROUP (per-location) library of reusable event templates (event
 * templates Phase 2). Two sections — "Task templates" and "Run-sheet templates"
 * — each list the group's saved templates with their item count, a "+ New …"
 * row, and per-row rename / delete. Tapping a template opens its item editor,
 * which reuses the same grids as the plan-level Event Tasks / Run sheet screens.
 *
 * This screen is library CRUD only. Applying a template to a plan (linkage,
 * propagation, save-to-template, plan-side pickers) lands in later phases.
 *
 * Route: /rostering/[group_id]/templates
 * Backend: scheduling.taskTemplates.* / scheduling.runSheetTemplates.*
 *
 * Auth: leaders / community admins only — mirrors EventTasksScreen's gate.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { CustomModal } from "@components/ui/Modal";
import { CenteredColumn } from "./CenteredColumn";
import { RosteringBackHeader } from "./RosteringBackHeader";
import {
  createTaskTemplateRef,
  renameTaskTemplateRef,
  deleteTaskTemplateRef,
  listTaskTemplatesRef,
  createRunSheetTemplateRef,
  renameRunSheetTemplateRef,
  deleteRunSheetTemplateRef,
  listRunSheetTemplatesRef,
  type TaskTemplateSummary,
  type RunSheetTemplateSummary,
} from "../api/eventTemplates";

/** Show a one-button error (Alert.alert is a no-op on web in this codebase). */
function notifyError(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/** Confirm a destructive action, cross-platform. */
function confirmDelete(prompt: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(prompt)) onConfirm();
    return;
  }
  Alert.alert("Delete template?", prompt, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: onConfirm },
  ]);
}

const errMsg = (e: unknown) => {
  const err = e as { data?: { message?: string } | string; message?: string };
  const data = err?.data;
  if (typeof data === "string") return data;
  return data?.message ?? err?.message ?? "Please try again.";
};

type EditingRow = {
  kind: "task" | "runsheet";
  id: string;
  name: string;
};

export function TemplatesLibraryScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;

  // Leader gate — mirrors EventTasksScreen. Community admins manage templates
  // even when they aren't a member/leader of this group (backend scheduler
  // permission), so `getById` may return no `userRole` for them.
  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    group_id ? { groupId } : "skip",
  ) as { userRole?: string } | null | undefined;
  const isLeader =
    groupData?.userRole === "leader" ||
    groupData?.userRole === "admin" ||
    user?.is_admin === true;

  const taskTemplates = useAuthenticatedQuery(
    listTaskTemplatesRef,
    isLeader && groupId ? { groupId } : "skip",
  ) as TaskTemplateSummary[] | undefined;

  const runSheetTemplates = useAuthenticatedQuery(
    listRunSheetTemplatesRef,
    isLeader && groupId ? { groupId } : "skip",
  ) as RunSheetTemplateSummary[] | undefined;

  const createTaskTemplate = useAuthenticatedMutation(createTaskTemplateRef);
  const renameTaskTemplate = useAuthenticatedMutation(renameTaskTemplateRef);
  const deleteTaskTemplate = useAuthenticatedMutation(deleteTaskTemplateRef);
  const createRunSheetTemplate = useAuthenticatedMutation(
    createRunSheetTemplateRef,
  );
  const renameRunSheetTemplate = useAuthenticatedMutation(
    renameRunSheetTemplateRef,
  );
  const deleteRunSheetTemplate = useAuthenticatedMutation(
    deleteRunSheetTemplateRef,
  );

  // Name modal — used for both "New …" (no `editing`) and rename (with the row).
  const [nameModal, setNameModal] = useState<
    | { mode: "create"; kind: "task" | "runsheet" }
    | { mode: "rename"; row: EditingRow }
    | null
  >(null);
  // Row action sheet (Rename · Delete) for a single template.
  const [actionRow, setActionRow] = useState<EditingRow | null>(null);

  const openTaskEditor = useCallback(
    (templateId: string) => {
      router.push(
        `/rostering/${groupId}/templates/task/${templateId}` as never,
      );
    },
    [router, groupId],
  );
  const openRunSheetEditor = useCallback(
    (templateId: string) => {
      router.push(
        `/rostering/${groupId}/templates/runsheet/${templateId}` as never,
      );
    },
    [router, groupId],
  );

  const handleSaveName = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const modal = nameModal;
      setNameModal(null);
      try {
        if (modal?.mode === "create") {
          if (modal.kind === "task") {
            const { templateId } = await createTaskTemplate({
              groupId,
              name: trimmed,
            });
            openTaskEditor(templateId as string);
          } else {
            const { templateId } = await createRunSheetTemplate({
              groupId,
              name: trimmed,
            });
            openRunSheetEditor(templateId as string);
          }
        } else if (modal?.mode === "rename") {
          if (modal.row.kind === "task") {
            await renameTaskTemplate({
              templateId: modal.row.id as Id<"eventTaskTemplates">,
              name: trimmed,
            });
          } else {
            await renameRunSheetTemplate({
              templateId: modal.row.id as Id<"runSheetTemplates">,
              name: trimmed,
            });
          }
        }
      } catch (e) {
        notifyError("Couldn't save template", errMsg(e));
      }
    },
    [
      nameModal,
      groupId,
      createTaskTemplate,
      createRunSheetTemplate,
      renameTaskTemplate,
      renameRunSheetTemplate,
      openTaskEditor,
      openRunSheetEditor,
    ],
  );

  const handleDelete = useCallback(
    (row: EditingRow) => {
      setActionRow(null);
      confirmDelete(`Delete "${row.name}" and all its items?`, () => {
        const run =
          row.kind === "task"
            ? deleteTaskTemplate({
                templateId: row.id as Id<"eventTaskTemplates">,
              })
            : deleteRunSheetTemplate({
                templateId: row.id as Id<"runSheetTemplates">,
              });
        void run.catch((e: unknown) =>
          notifyError("Couldn't delete template", errMsg(e)),
        );
      });
    },
    [deleteTaskTemplate, deleteRunSheetTemplate],
  );

  // --- Gating states ---------------------------------------------------------
  if (groupData === undefined) {
    return (
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        <RosteringBackHeader title="Templates" />
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      </View>
    );
  }
  if (!isLeader) {
    return (
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        <RosteringBackHeader title="Templates" />
        <View style={styles.centered}>
          <Ionicons
            name="people-outline"
            size={40}
            color={colors.iconSecondary}
          />
          <Text style={[styles.gateText, { color: colors.textSecondary }]}>
            Only leaders can manage templates.
          </Text>
        </View>
      </View>
    );
  }

  const loading = taskTemplates === undefined || runSheetTemplates === undefined;

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <RosteringBackHeader title="Templates" />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : (
        <ScrollView
          style={{ backgroundColor: colors.surface }}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          <CenteredColumn style={styles.column}>
            <Text style={[styles.intro, { color: colors.textSecondary }]}>
              Reusable checklists and run sheets for this location. Save one once,
              then apply it when you plan an event.
            </Text>

            <Section
              title="Task templates"
              icon="checkbox-outline"
              colors={colors}
            >
              {(taskTemplates ?? []).map((t) => (
                <TemplateRow
                  key={t._id}
                  name={t.name}
                  itemCount={t.itemCount}
                  itemNoun="task"
                  colors={colors}
                  onOpen={() => openTaskEditor(t._id as string)}
                  onMenu={() =>
                    setActionRow({
                      kind: "task",
                      id: t._id as string,
                      name: t.name,
                    })
                  }
                />
              ))}
              <NewRow
                label="New task template"
                colors={colors}
                primaryColor={primaryColor}
                onPress={() => setNameModal({ mode: "create", kind: "task" })}
              />
            </Section>

            <Section
              title="Run-sheet templates"
              icon="list-outline"
              colors={colors}
            >
              {(runSheetTemplates ?? []).map((t) => (
                <TemplateRow
                  key={t._id}
                  name={t.name}
                  itemCount={t.itemCount}
                  itemNoun="item"
                  colors={colors}
                  onOpen={() => openRunSheetEditor(t._id as string)}
                  onMenu={() =>
                    setActionRow({
                      kind: "runsheet",
                      id: t._id as string,
                      name: t.name,
                    })
                  }
                />
              ))}
              <NewRow
                label="New run-sheet template"
                colors={colors}
                primaryColor={primaryColor}
                onPress={() =>
                  setNameModal({ mode: "create", kind: "runsheet" })
                }
              />
            </Section>
          </CenteredColumn>
        </ScrollView>
      )}

      {/* Name modal — create or rename. */}
      <NameModal
        visible={nameModal !== null}
        title={nameModal?.mode === "rename" ? "Rename template" : "New template"}
        initialValue={
          nameModal?.mode === "rename" ? nameModal.row.name : ""
        }
        colors={colors}
        primaryColor={primaryColor}
        onSave={handleSaveName}
        onClose={() => setNameModal(null)}
      />

      {/* Per-row action sheet: Rename · Delete. */}
      <CustomModal
        visible={actionRow !== null}
        onClose={() => setActionRow(null)}
        title={actionRow?.name}
      >
        {actionRow ? (
          <View>
            <Pressable
              onPress={() => {
                const row = actionRow;
                setActionRow(null);
                setNameModal({ mode: "rename", row });
              }}
              style={[styles.menuRow, { borderBottomColor: colors.border }]}
              accessibilityRole="button"
            >
              <Ionicons name="pencil-outline" size={20} color={colors.text} />
              <Text style={[styles.menuLabel, { color: colors.text }]}>
                Rename
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleDelete(actionRow)}
              style={styles.menuRow}
              accessibilityRole="button"
            >
              <Ionicons
                name="trash-outline"
                size={20}
                color={colors.destructive}
              />
              <Text style={[styles.menuLabel, { color: colors.destructive }]}>
                Delete
              </Text>
            </Pressable>
          </View>
        ) : null}
      </CustomModal>
    </View>
  );
}

function Section({
  title,
  icon,
  colors,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  colors: ReturnType<typeof useTheme>["colors"];
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={16} color={colors.textSecondary} />
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          {title.toUpperCase()}
        </Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function TemplateRow({
  name,
  itemCount,
  itemNoun,
  colors,
  onOpen,
  onMenu,
}: {
  name: string;
  itemCount: number;
  itemNoun: string;
  colors: ReturnType<typeof useTheme>["colors"];
  onOpen: () => void;
  onMenu: () => void;
}) {
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onMenu}
      style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}
      accessibilityRole="button"
    >
      <View style={styles.cardMain}>
        <Text
          style={[styles.cardTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
          {itemCount} {itemCount === 1 ? itemNoun : `${itemNoun}s`}
        </Text>
      </View>
      <Pressable
        onPress={onMenu}
        hitSlop={10}
        style={styles.menuBtn}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${name}`}
      >
        <Ionicons
          name="ellipsis-horizontal"
          size={20}
          color={colors.textSecondary}
        />
      </Pressable>
    </Pressable>
  );
}

function NewRow({
  label,
  colors,
  primaryColor,
  onPress,
}: {
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.newRow, { borderColor: primaryColor }]}
      accessibilityRole="button"
    >
      <Ionicons name="add" size={20} color={primaryColor} />
      <Text style={[styles.newLabel, { color: primaryColor }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A small name-entry modal used for both creating and renaming a template.
 * Remounted per open via `key` so it re-seeds `initialValue`.
 */
function NameModal({
  visible,
  title,
  initialValue,
  colors,
  primaryColor,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <CustomModal visible={visible} onClose={onClose} title={title}>
      <NameModalBody
        key={`${title}:${initialValue}`}
        initialValue={initialValue}
        colors={colors}
        primaryColor={primaryColor}
        onSave={onSave}
      />
    </CustomModal>
  );
}

function NameModalBody({
  initialValue,
  colors,
  primaryColor,
  onSave,
}: {
  initialValue: string;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const canSave = value.trim().length > 0;
  return (
    <View style={styles.modalBody}>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="Template name"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        maxLength={50}
        returnKeyType="done"
        onSubmitEditing={() => canSave && onSave(value)}
        accessibilityLabel="Template name"
        style={[
          styles.nameInput,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      <Pressable
        onPress={() => canSave && onSave(value)}
        disabled={!canSave}
        style={[
          styles.saveBtn,
          { backgroundColor: primaryColor, opacity: canSave ? 1 : 0.5 },
        ]}
        accessibilityRole="button"
      >
        <Text style={styles.saveBtnText}>Save</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  gateText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  content: { padding: 16, gap: 20 },
  column: { gap: 20 },
  intro: { fontSize: 14, lineHeight: 20 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  sectionBody: { gap: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 6,
    gap: 8,
  },
  cardMain: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardMeta: { fontSize: 13 },
  menuBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  newRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 14,
  },
  newLabel: { fontSize: 15, fontWeight: "600" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuLabel: { fontSize: 16, fontWeight: "500" },
  modalBody: { gap: 12, paddingTop: 4 },
  nameInput: {
    fontSize: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  saveBtn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
