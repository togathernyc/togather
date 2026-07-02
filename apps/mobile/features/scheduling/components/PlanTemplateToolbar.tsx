/**
 * PlanTemplateToolbar
 *
 * The plan-side template controls shared by the Event Tasks screen and the Run
 * Sheet screen (Phase 4). One presentational toolbar, wired by each screen to
 * its own kind's backend contract (task vs run-sheet), so the two screens stay
 * identical in behaviour without duplicating the menus/modals.
 *
 * It renders three things:
 *  1. A template PICKER — "<label>: [ <name or None> ▾ ]" opening an
 *     AnchoredMenu of the group's templates plus a "None (unlink)" row. Picking
 *     a DIFFERENT template while the plan has local edits first prompts the
 *     leader to copy or discard those edits (switch-with-carryover). Switching
 *     is disabled (shown read-only) once the event is past.
 *  2. An "Edited for this event" amber indicator (when the plan diverges from
 *     its linked template) with "Save to template" (push edits back into the
 *     linked template) and "Revert to template" actions.
 *  3. A "Save as template ▾" affordance — save the plan's current list into a
 *     New template, or Add to an existing one (Replace / Merge). Works whether
 *     or not a template is currently linked.
 *
 * This component is intentionally presentational and string-typed on ids: each
 * screen owns the correctly-typed `makeFunctionReference` calls (task ids vs
 * run-sheet ids) and passes down thin callbacks, so this file never has to
 * juggle the two Id unions.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  type TextStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { AnchoredMenu, measureAnchor, type AnchorRect } from "./AnchoredMenu";
import { CustomModal } from "@components/ui/Modal";
import { ConfirmModal } from "@components/ui/ConfirmModal";
import type {
  TemplateCarryover,
  SaveTemplateStrategy,
} from "../api/planTemplates";

/** A template as listed for the picker (task or run-sheet). */
export type TemplateSummary = { _id: string; name: string; itemCount: number };

/** The kind-specific slice of `getPlanTemplateState` this toolbar renders. */
export type PlanTemplateSlice = {
  templateId: string | null;
  templateName: string | null;
  hasEdits: boolean;
  isPast: boolean;
};

const webNoOutline: TextStyle | undefined =
  Platform.OS === "web"
    ? ({ outlineStyle: "none" } as unknown as TextStyle)
    : undefined;

export function PlanTemplateToolbar({
  label,
  itemNoun,
  state,
  templates,
  onSetTemplate,
  onSaveNew,
  onSaveExisting,
  onRevert,
}: {
  /** Picker prefix, e.g. "Task template" or "Run-sheet template". */
  label: string;
  /** Plural noun for prompt copy, e.g. "tasks" or "run-sheet items". */
  itemNoun: string;
  /** Kind-specific linkage/edit state; `undefined` while loading. */
  state: PlanTemplateSlice | undefined;
  /** Group templates for the picker / "add to existing"; `undefined` loading. */
  templates: TemplateSummary[] | undefined;
  onSetTemplate: (
    templateId: string | null,
    carryover: TemplateCarryover,
  ) => void;
  onSaveNew: (name: string) => void;
  onSaveExisting: (templateId: string, strategy: SaveTemplateStrategy) => void;
  onRevert: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const pickerRef = useRef<View>(null);
  const saveAsRef = useRef<View>(null);

  // Which anchored menu is open. "saveExisting" reuses the Save-as anchor to
  // show the list of templates to add the current list into.
  const [menu, setMenu] = useState<{
    kind: "picker" | "saveAs" | "saveExisting";
    anchor: AnchorRect;
  } | null>(null);

  // The switch-with-carryover prompt: the template we're switching TO (always a
  // real template — unlink has its own confirm) plus its display name, held
  // until the leader chooses copy/discard.
  const [carryoverPrompt, setCarryoverPrompt] = useState<{
    targetId: string;
    targetName: string;
  } | null>(null);

  // Unlinking ("None") gets a plain confirm — the backend ignores `carryover`
  // on the unlink branch (rows just become regular local items).
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);

  // The Replace/Merge prompt for "Add to existing".
  const [strategyPrompt, setStrategyPrompt] = useState<{
    templateId: string;
    templateName: string;
  } | null>(null);

  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirm, setConfirm] = useState<null | "saveTo" | "revert">(null);

  const isPast = state?.isPast ?? false;
  const hasEdits = state?.hasEdits ?? false;
  const linkedId = state?.templateId ?? null;
  const linkedName = state?.templateName ?? null;

  const templateNameFor = (id: string | null): string =>
    id ? (templates?.find((t) => t._id === id)?.name ?? "that template") : "None";

  // --- Picker -----------------------------------------------------------------
  const openPicker = () => {
    if (isPast) return;
    measureAnchor(pickerRef.current, (anchor) =>
      setMenu({ kind: "picker", anchor }),
    );
  };

  const handlePick = (id: string | null) => {
    setMenu(null);
    if (id === linkedId) return; // no-op: same template chosen
    if (id === null) {
      // Unlink — carryover is ignored on this branch; just confirm.
      setUnlinkConfirm(true);
      return;
    }
    if (hasEdits) {
      // Diverged from the linked template — ask what to do with the edits
      // before we replace the list.
      setCarryoverPrompt({ targetId: id, targetName: templateNameFor(id) });
    } else {
      onSetTemplate(id, "discard");
    }
  };

  // --- Save as ----------------------------------------------------------------
  const openSaveAs = () => {
    measureAnchor(saveAsRef.current, (anchor) =>
      setMenu({ kind: "saveAs", anchor }),
    );
  };

  const handleSaveAsChoice = (id: string | null) => {
    if (id === "new") {
      setMenu(null);
      setNameDraft("");
      setNameModalOpen(true);
    } else if (id === "existing") {
      // Swap the same anchored menu to the list of templates to merge into.
      setMenu((m) => (m ? { kind: "saveExisting", anchor: m.anchor } : m));
    }
  };

  const handleSaveExistingPick = (id: string | null) => {
    setMenu(null);
    if (!id) return;
    setStrategyPrompt({ templateId: id, templateName: templateNameFor(id) });
  };

  const submitName = () => {
    const name = nameDraft.trim();
    if (!name) return;
    onSaveNew(name);
    setNameModalOpen(false);
    setNameDraft("");
  };

  // --- Render -----------------------------------------------------------------
  const pickerValue = linkedName ?? "None";

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {/* Template picker */}
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {label}:
        </Text>
        {isPast ? (
          // Past events: the linkage is read-only.
          <View
            style={[
              styles.pill,
              { borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
            ]}
          >
            <Text
              style={[styles.pillText, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {pickerValue}
            </Text>
          </View>
        ) : (
          <View ref={pickerRef} collapsable={false}>
            <TouchableOpacity
              onPress={openPicker}
              disabled={state === undefined}
              style={[
                styles.pill,
                {
                  borderColor: linkedId ? primaryColor : colors.border,
                  backgroundColor: linkedId ? primaryColor + "14" : "transparent",
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${pickerValue}. Tap to change.`}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: linkedId ? primaryColor : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {pickerValue}
              </Text>
              <Ionicons
                name="chevron-down"
                size={13}
                color={linkedId ? primaryColor : colors.textTertiary}
              />
            </TouchableOpacity>
          </View>
        )}

        {/* Save as template */}
        <View ref={saveAsRef} collapsable={false} style={styles.saveAsHost}>
          <TouchableOpacity
            onPress={openSaveAs}
            style={[styles.saveAsBtn, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Save as template"
          >
            <Ionicons name="bookmark-outline" size={14} color={colors.text} />
            <Text style={[styles.saveAsText, { color: colors.text }]}>
              Save as template
            </Text>
            <Ionicons name="chevron-down" size={13} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Edited-for-this-event indicator + actions */}
      {hasEdits ? (
        <View style={styles.editedRow}>
          <View
            style={[
              styles.editedPill,
              { backgroundColor: colors.warning + "1F", borderColor: colors.warning },
            ]}
          >
            <Text style={[styles.editedDot, { color: colors.warning }]}>●</Text>
            <Text style={[styles.editedText, { color: colors.warning }]}>
              Edited for this event
            </Text>
          </View>
          {linkedId ? (
            <TouchableOpacity
              onPress={() => setConfirm("saveTo")}
              style={styles.editedAction}
              accessibilityRole="button"
            >
              <Text style={[styles.editedActionText, { color: primaryColor }]}>
                Save to template
              </Text>
            </TouchableOpacity>
          ) : null}
          {/* Revert rewrites the (now frozen) plan — the backend rejects it on
              a past event, so hide it there. Save-to-template stays (it writes
              to the TEMPLATE, not the plan). */}
          {!isPast ? (
            <TouchableOpacity
              onPress={() => setConfirm("revert")}
              style={styles.editedAction}
              accessibilityRole="button"
            >
              <Text style={[styles.editedActionText, { color: colors.textSecondary }]}>
                Revert to template
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Picker menu — group's templates + "None (unlink)". */}
      {menu?.kind === "picker" ? (
        <AnchoredMenu
          anchor={menu.anchor}
          options={(templates ?? []).map((t) => ({
            id: t._id,
            name: `${t.name} · ${t.itemCount}`,
          }))}
          selectedId={linkedId}
          emptyOption={{ label: "None (unlink)" }}
          onSelect={handlePick}
          onClose={() => setMenu(null)}
          maxWidth={320}
        />
      ) : null}

      {/* Save-as menu — New template… / Add to existing… */}
      {menu?.kind === "saveAs" ? (
        <AnchoredMenu
          anchor={menu.anchor}
          options={[
            { id: "new", name: "New template…" },
            { id: "existing", name: "Add to existing…" },
          ]}
          onSelect={handleSaveAsChoice}
          onClose={() => setMenu(null)}
          maxWidth={260}
        />
      ) : null}

      {/* Save-as → existing: pick the template to merge/replace into. */}
      {menu?.kind === "saveExisting" ? (
        <AnchoredMenu
          anchor={menu.anchor}
          options={(templates ?? []).map((t) => ({
            id: t._id,
            name: `${t.name} · ${t.itemCount}`,
          }))}
          onSelect={handleSaveExistingPick}
          onClose={() => setMenu(null)}
          maxWidth={320}
        />
      ) : null}

      {/* Switch-with-carryover prompt. */}
      <ChoiceModal
        visible={carryoverPrompt !== null}
        title="Switch template"
        message={`You've edited these ${itemNoun} for this event. Switching to "${
          carryoverPrompt?.targetName ?? ""
        }" will replace the list.`}
        options={[
          {
            key: "copy",
            label: `Copy my edits into "${carryoverPrompt?.targetName ?? ""}"`,
          },
          { key: "discard", label: "Discard my edits" },
        ]}
        confirmLabel="Switch"
        onConfirm={(key) => {
          if (carryoverPrompt) {
            onSetTemplate(
              carryoverPrompt.targetId,
              key as TemplateCarryover,
            );
          }
          setCarryoverPrompt(null);
        }}
        onCancel={() => setCarryoverPrompt(null)}
      />

      {/* Unlink confirm — "None (unlink)". */}
      <ConfirmModal
        visible={unlinkConfirm}
        title="Unlink template"
        message={`Your current ${itemNoun} stay on this event as regular ${itemNoun}.`}
        confirmText="Unlink"
        onConfirm={() => {
          onSetTemplate(null, "discard");
          setUnlinkConfirm(false);
        }}
        onCancel={() => setUnlinkConfirm(false)}
      />

      {/* Replace / Merge prompt for "Add to existing". */}
      <ChoiceModal
        visible={strategyPrompt !== null}
        title={`Save to "${strategyPrompt?.templateName ?? ""}"`}
        message="Choose how this event's list is written into the template."
        options={[
          { key: "replace", label: "Replace", hint: "Overwrite the template's items with this list." },
          { key: "merge", label: "Merge", hint: "Add this list on top of the template's items." },
        ]}
        confirmLabel="Save"
        onConfirm={(key) => {
          if (strategyPrompt) {
            onSaveExisting(strategyPrompt.templateId, key as SaveTemplateStrategy);
          }
          setStrategyPrompt(null);
        }}
        onCancel={() => setStrategyPrompt(null)}
      />

      {/* New-template name prompt. */}
      <CustomModal
        visible={nameModalOpen}
        onClose={() => setNameModalOpen(false)}
        title="New template"
      >
        <View style={styles.nameModal}>
          <Text style={[styles.nameHint, { color: colors.textSecondary }]}>
            Save this event's {itemNoun} as a reusable template.
          </Text>
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="Template name"
            placeholderTextColor={colors.inputPlaceholder}
            autoFocus
            maxLength={80}
            onSubmitEditing={submitName}
            returnKeyType="done"
            accessibilityLabel="Template name"
            style={[
              styles.nameInput,
              { color: colors.text, borderColor: colors.border },
              webNoOutline,
            ]}
          />
          <View style={styles.nameButtons}>
            <TouchableOpacity
              onPress={() => setNameModalOpen(false)}
              style={[styles.nameBtn, { backgroundColor: colors.surfaceSecondary }]}
            >
              <Text style={[styles.nameBtnText, { color: colors.text }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submitName}
              disabled={nameDraft.trim().length === 0}
              style={[
                styles.nameBtn,
                {
                  backgroundColor: primaryColor,
                  opacity: nameDraft.trim().length === 0 ? 0.5 : 1,
                },
              ]}
            >
              <Text style={[styles.nameBtnText, { color: colors.buttonPrimaryText }]}>
                Create
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </CustomModal>

      {/* Save-to-template confirm. */}
      <ConfirmModal
        visible={confirm === "saveTo"}
        title="Save to template"
        message="Updates the template — future events using it get these; past events are unchanged."
        confirmText="Save to template"
        onConfirm={() => {
          if (linkedId) onSaveExisting(linkedId, "replace");
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />

      {/* Revert-to-template confirm. */}
      <ConfirmModal
        visible={confirm === "revert"}
        title="Revert to template"
        message="Discards this event's edits and restores the template's items."
        confirmText="Revert"
        destructive
        onConfirm={() => {
          onRevert();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}

/**
 * A small radio-choice confirm modal — two-or-more mutually exclusive options
 * with a confirm/cancel footer. Used for the copy/discard carryover prompt and
 * the replace/merge save prompt.
 */
function ChoiceModal({
  visible,
  title,
  message,
  options,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  options: Array<{ key: string; label: string; hint?: string }>;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (key: string) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [selected, setSelected] = useState(options[0]?.key ?? "");

  // Re-seed the default selection each time the modal (re)opens.
  useEffect(() => {
    if (visible) setSelected(options[0]?.key ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options identity churns per render; re-seed only on open
  }, [visible]);

  return (
    <CustomModal visible={visible} onClose={onCancel} title={title} withoutCloseBtn>
      <View style={styles.choiceBody}>
        <Text style={[styles.choiceMessage, { color: colors.text }]}>{message}</Text>
        {options.map((o) => {
          const active = selected === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              onPress={() => setSelected(o.key)}
              style={[
                styles.choiceRow,
                {
                  borderColor: active ? primaryColor : colors.border,
                  backgroundColor: active ? primaryColor + "12" : "transparent",
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={active ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={active ? primaryColor : colors.textTertiary}
              />
              <View style={styles.choiceTextWrap}>
                <Text style={[styles.choiceLabel, { color: colors.text }]}>
                  {o.label}
                </Text>
                {o.hint ? (
                  <Text style={[styles.choiceHint, { color: colors.textSecondary }]}>
                    {o.hint}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
        <View style={styles.choiceButtons}>
          <TouchableOpacity
            onPress={onCancel}
            style={[styles.nameBtn, { backgroundColor: colors.surfaceSecondary }]}
          >
            <Text style={[styles.nameBtnText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onConfirm(selected)}
            style={[
              styles.nameBtn,
              { backgroundColor: destructive ? colors.destructive : primaryColor },
            ]}
          >
            <Text style={[styles.nameBtnText, { color: colors.buttonPrimaryText }]}>
              {confirmLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 14,
    width: "100%",
    maxWidth: 1200,
    alignSelf: "center",
    gap: 8,
  },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  label: { fontSize: 13, fontWeight: "600" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 240,
  },
  pillText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  saveAsHost: { marginLeft: "auto" },
  saveAsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveAsText: { fontSize: 13, fontWeight: "600" },
  editedRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  editedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  editedDot: { fontSize: 10 },
  editedText: { fontSize: 12, fontWeight: "700" },
  editedAction: { paddingVertical: 4 },
  editedActionText: { fontSize: 13, fontWeight: "600" },
  // --- New-template name prompt ---
  nameModal: { gap: 14 },
  nameHint: { fontSize: 14, lineHeight: 20 },
  nameInput: {
    fontSize: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  nameButtons: { flexDirection: "row", gap: 12 },
  nameBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  nameBtnText: { fontSize: 15, fontWeight: "600" },
  // --- Choice (radio) modal ---
  choiceBody: { gap: 12, paddingTop: 4 },
  choiceMessage: { fontSize: 15, lineHeight: 21 },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  choiceTextWrap: { flex: 1, gap: 2 },
  choiceLabel: { fontSize: 15, fontWeight: "600" },
  choiceHint: { fontSize: 13, lineHeight: 18 },
  choiceButtons: { flexDirection: "row", gap: 12, marginTop: 4 },
});
