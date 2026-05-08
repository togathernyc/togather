/**
 * PollCreatorSheet — modal sheet for creating and editing polls.
 *
 * Used in two modes:
 *  - "create": user is composing a brand-new poll. Sheet calls
 *    `createPoll` and dismisses on success.
 *  - "edit": author or leader is editing an existing poll. Existing
 *    options keep their `id` so vote rows survive text edits; new
 *    options are added without an id and the server assigns one.
 *
 * The sheet keeps its own draft state and only commits on Send/Save.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Switch,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Id } from '@services/api/convex';
import { api, useAuthenticatedMutation } from '@services/api/convex';
import { useTheme } from '@hooks/useTheme';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const MAX_QUESTION_LENGTH = 280;
const MAX_OPTION_LENGTH = 120;

interface OptionDraft {
  /** Existing option id (preserved on edit) or undefined for new options. */
  id?: string;
  text: string;
}

interface CreateModeProps {
  visible: boolean;
  mode: 'create';
  channelId: Id<'chatChannels'>;
  viewingGroupId?: Id<'groups'>;
  onClose: () => void;
}

interface EditModeProps {
  visible: boolean;
  mode: 'edit';
  pollId: Id<'polls'>;
  initialQuestion: string;
  initialOptions: Array<{ id: string; text: string }>;
  initialAllowMultiple: boolean;
  onClose: () => void;
}

type PollCreatorSheetProps = CreateModeProps | EditModeProps;

export function PollCreatorSheet(props: PollCreatorSheetProps) {
  const { visible, mode, onClose } = props;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<OptionDraft[]>([{ text: '' }, { text: '' }]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const createPoll = useAuthenticatedMutation(api.functions.messaging.polls.createPoll);
  const editPoll = useAuthenticatedMutation(api.functions.messaging.polls.editPoll);

  // Reset draft when the sheet opens. For edit mode, hydrate from the
  // existing poll snapshot at open time. For create mode, start clean.
  // Only depend on `visible` here — including `props` would re-run the
  // effect on every render (typing in the question/options calls
  // setState, which re-renders and produces a new props object identity),
  // wiping the user's in-progress draft on every keystroke.
  const initialQuestion = mode === 'edit' ? props.initialQuestion : undefined;
  const initialOptions = mode === 'edit' ? props.initialOptions : undefined;
  const initialAllowMultiple = mode === 'edit' ? props.initialAllowMultiple : undefined;
  useEffect(() => {
    if (!visible) return;
    if (mode === 'edit') {
      setQuestion(initialQuestion ?? '');
      setOptions(
        (initialOptions ?? []).map((o) => ({ id: o.id, text: o.text })),
      );
      setAllowMultiple(initialAllowMultiple ?? false);
    } else {
      setQuestion('');
      setOptions([{ text: '' }, { text: '' }]);
      setAllowMultiple(false);
    }
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const trimmedOptions = useMemo(
    () => options.map((o) => ({ ...o, text: o.text.trim() })),
    [options],
  );

  const canSubmit =
    !submitting &&
    question.trim().length > 0 &&
    trimmedOptions.length >= MIN_OPTIONS &&
    trimmedOptions.every((o) => o.text.length > 0);

  const updateOption = useCallback((index: number, text: string) => {
    setOptions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], text };
      return next;
    });
  }, []);

  const addOption = useCallback(() => {
    setOptions((prev) => {
      if (prev.length >= MAX_OPTIONS) return prev;
      return [...prev, { text: '' }];
    });
  }, []);

  const removeOption = useCallback((index: number) => {
    setOptions((prev) => {
      if (prev.length <= MIN_OPTIONS) return prev;
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await createPoll({
          channelId: props.channelId,
          question: question.trim(),
          options: trimmedOptions.map((o) => o.text),
          allowMultiple,
          ...(props.viewingGroupId ? { viewingGroupId: props.viewingGroupId } : {}),
        });
      } else {
        await editPoll({
          pollId: props.pollId,
          question: question.trim(),
          options: trimmedOptions.map((o) =>
            o.id ? { id: o.id, text: o.text } : { text: o.text },
          ),
          allowMultiple,
        });
      }
      onClose();
    } catch (e: any) {
      const msg =
        e?.data?.message ||
        e?.message ||
        (mode === 'create' ? 'Failed to create poll' : 'Failed to update poll');
      Alert.alert('Error', String(msg));
      setSubmitting(false);
    }
  }, [
    canSubmit,
    mode,
    createPoll,
    editPoll,
    props,
    question,
    trimmedOptions,
    allowMultiple,
    onClose,
  ]);

  const title = mode === 'create' ? 'New Poll' : 'Edit Poll';
  const submitLabel = mode === 'create' ? 'Send' : 'Save';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Math.max(insets.top, 12),
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={8} disabled={submitting}>
            <Text style={[styles.headerAction, { color: colors.link }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
          <Pressable
            onPress={handleSubmit}
            hitSlop={8}
            disabled={!canSubmit}
            style={!canSubmit ? styles.headerActionDisabled : undefined}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.link} />
            ) : (
              <Text
                style={[
                  styles.headerAction,
                  styles.headerActionPrimary,
                  { color: colors.link },
                ]}
              >
                {submitLabel}
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Question */}
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>QUESTION</Text>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="Ask a question…"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={MAX_QUESTION_LENGTH}
            style={[
              styles.questionInput,
              {
                color: colors.text,
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
              },
            ]}
            editable={!submitting}
          />

          {/* Options */}
          <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 24 }]}>
            OPTIONS
          </Text>
          {options.map((opt, idx) => (
            <View key={idx} style={styles.optionRow}>
              <View
                style={[
                  styles.optionInputWrap,
                  { backgroundColor: colors.inputBackground, borderColor: colors.border },
                ]}
              >
                <TextInput
                  value={opt.text}
                  onChangeText={(t) => updateOption(idx, t)}
                  placeholder={`Option ${idx + 1}`}
                  placeholderTextColor={colors.textTertiary}
                  maxLength={MAX_OPTION_LENGTH}
                  style={[styles.optionInput, { color: colors.text }]}
                  editable={!submitting}
                />
              </View>
              {options.length > MIN_OPTIONS && (
                <Pressable
                  onPress={() => removeOption(idx)}
                  hitSlop={8}
                  style={styles.optionRemove}
                  disabled={submitting}
                >
                  <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
                </Pressable>
              )}
            </View>
          ))}
          {options.length < MAX_OPTIONS && (
            <Pressable
              onPress={addOption}
              style={styles.addOptionButton}
              disabled={submitting}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.link} />
              <Text style={[styles.addOptionLabel, { color: colors.link }]}>
                Add option
              </Text>
            </Pressable>
          )}

          {/* Settings */}
          <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 24 }]}>
            SETTINGS
          </Text>
          <View
            style={[
              styles.settingRow,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <View style={styles.settingTextWrap}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Allow multiple choices
              </Text>
              <Text style={[styles.settingHint, { color: colors.textSecondary }]}>
                Voters can pick more than one option.
              </Text>
            </View>
            <Switch
              value={allowMultiple}
              onValueChange={setAllowMultiple}
              disabled={submitting}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerAction: {
    fontSize: 16,
  },
  headerActionPrimary: {
    fontWeight: '600',
  },
  headerActionDisabled: {
    opacity: 0.4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  questionInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  optionInputWrap: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  optionInput: {
    fontSize: 16,
    paddingVertical: 8,
  },
  optionRemove: {
    padding: 4,
  },
  addOptionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  addOptionLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
  settingTextWrap: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingHint: {
    fontSize: 13,
    marginTop: 2,
  },
});
