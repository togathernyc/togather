import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  Switch,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useAuthenticatedMutation, api } from '@services/api/convex';
import { formatError } from '@/utils/error-handling';
import type { Id } from '@services/api/convex';

const MAX_BODY = 500;

interface Props {
  visible: boolean;
  onClose: () => void;
  onPosted: () => void;
}

function displayInitial(firstName?: string, lastName?: string): string {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  if (!f && !l) return 'Anonymous';
  if (!l) return f;
  return `${f} ${l.charAt(0).toUpperCase()}.`;
}

// Common relationship words people use when describing another person.
const RELATIONSHIP_WORDS = [
  'husband','wife','spouse','partner','boyfriend','girlfriend','ex',
  'son','daughter','child','kid',
  'mom','mother','dad','father','parent','sister','brother','sibling',
  'aunt','uncle','cousin','niece','nephew','grandma','grandpa','grandmother','grandfather',
  'friend','neighbor','coworker','boss','colleague','classmate','roommate',
  'pastor','elder','leader','teacher',
];
const ACCUSATION_WORDS = [
  'abusive','abuse','abuser','beat','beats','beating','hits','hit',
  'cheating','cheated','cheats','affair','unfaithful',
  'lying','lies','liar','deceitful','manipulative','narcissist','narcissistic','toxic',
  'alcoholic','addict','addicted','using','drinking','drugs',
  'stealing','stole','steals','fraud',
  'porn','pornography','adultery',
  'absent','abandoned','neglecting','neglect',
  'angry','rage','rageful','violent','controlling','gaslighting','gaslights',
];

/**
 * Catches "my <relationship> <CapitalizedWord>" — the strongest signal that
 * a specific third party is being named. Capitalized word must come AFTER
 * the relationship (so "My brother is sick" doesn't match, but
 * "my brother John is sick" does).
 *
 * We also catch a standalone "<CapitalizedName> is/has/needs/got" pattern
 * for cases like "Mike got laid off, pray for him" — common but still
 * exposes someone unnecessarily.
 *
 * Both patterns deliberately allow common false-positives through (e.g.
 * "I" as a standalone capitalized word) — better to underfire than to
 * cry wolf and train the user to dismiss the warning.
 */
const NAME_AFTER_RELATIONSHIP = new RegExp(
  `\\bmy\\s+(?:${RELATIONSHIP_WORDS.join('|')})\\s+([A-Z][a-z]{2,})\\b`,
);
const NAME_AS_SUBJECT = /\b([A-Z][a-z]{2,})\s+(?:is|has|needs|got|just|recently|will|was|got)\b/;

/** Reserved first words & common false positives that aren't names. */
const NOT_NAMES = new Set([
  'Please','God','Jesus','Lord','Christ','Father','Holy','Spirit',
  'Today','Tomorrow','Yesterday','This','That','We','They','He','She','It',
  'My','Our','Their','His','Her',
  'Pray','Asking','Hoping','Praying',
]);

function detectsSpecificName(text: string): boolean {
  const checkMatch = (match: RegExpMatchArray | null): boolean =>
    !!match && !NOT_NAMES.has(match[1]);
  return (
    checkMatch(text.match(NAME_AFTER_RELATIONSHIP)) ||
    checkMatch(text.match(NAME_AS_SUBJECT))
  );
}

/**
 * Catches intimate/explicit phrasing that doesn't belong on a public
 * community prayer feed even when the post is sincere. The author
 * usually didn't intend to overshare — they just used the most natural
 * words. The nudge suggests the closest gentler phrasing.
 */
const INTIMATE_PATTERNS: { test: RegExp; suggest: string }[] = [
  { test: /\bsex(ual)?\s+life\b/i,            suggest: '"intimacy in our marriage"' },
  { test: /\bhaving\s+sex\b/i,                suggest: '"closeness in our marriage"' },
  { test: /\bour\s+sex\b/i,                   suggest: '"our marriage"' },
  { test: /\bporn(ography)?\b/i,              suggest: '"an addiction"' },
  { test: /\bmasturbat/i,                     suggest: '"a private struggle"' },
  { test: /\b(bedroom|sexual)\s+(struggle|issue|problem|trouble)/i, suggest: '"a private struggle in our marriage"' },
  { test: /\bintimacy\s+(issue|struggle|problem|trouble|lack)/i,     suggest: '"closeness in our marriage"' },
];

function detectsIntimate(text: string): { suggest: string } | null {
  for (const p of INTIMATE_PATTERNS) {
    if (p.test.test(text)) return { suggest: p.suggest };
  }
  return null;
}

function detectsAccusation(text: string): boolean {
  const lower = text.toLowerCase();
  const hasRelationship = RELATIONSHIP_WORDS.some((w) =>
    new RegExp(`\\bmy\\s+${w}\\b`, 'i').test(lower),
  );
  const hasAccusation = ACCUSATION_WORDS.some((w) =>
    new RegExp(`\\b${w}\\b`, 'i').test(lower),
  );
  return hasRelationship && hasAccusation;
}

export function AddPrayerSheet({ visible, onClose, onPosted }: Props) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const { user, community } = useAuth();
  const [text, setText] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createPrayer = useAuthenticatedMutation(api.functions.prayers.createPrayer);

  useEffect(() => {
    if (visible) {
      setText('');
      setIsAnonymous(false);
    }
  }, [visible]);

  const submitNow = async () => {
    const body = text.trim();
    if (body.length === 0) return;
    if (!community?.id) return;

    setIsSubmitting(true);
    try {
      await createPrayer({
        communityId: community.id as Id<'communities'>,
        bodyText: body,
        isAnonymous,
      });
      onPosted();
      onClose();
    } catch (e: any) {
      const msg = formatError(e, 'Could not post your prayer');
      Alert.alert('Prayer not posted', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = () => {
    const body = text.trim();
    if (body.length === 0) return;

    // Intimate/explicit phrasing first — these are usually sincere posts
    // where the author didn't realize the wording was too detailed for a
    // public church feed. Surface a gentler suggestion before they post.
    const intimate = detectsIntimate(body);
    if (intimate) {
      Alert.alert(
        'Keep it more general?',
        `This is a public prayer feed, so it helps to keep intimate details general. Try ${intimate.suggest} instead — your community will know how to pray.`,
        [
          { text: 'Edit', style: 'cancel' },
          { text: 'Post anyway', onPress: submitNow },
        ],
      );
      return;
    }

    // Stronger warning takes precedence. Naming + accusation is the legal/
    // defamation hazard; naming alone is just a courtesy nudge.
    if (detectsAccusation(body)) {
      Alert.alert(
        'Protect their privacy',
        "It looks like you're sharing sensitive details about someone else. We don't recommend posting accusations publicly — consider sharing this more privately with your church staff instead.",
        [
          { text: 'Edit', style: 'cancel' },
          { text: 'Post anyway', style: 'destructive', onPress: submitNow },
        ],
      );
      return;
    }
    if (detectsSpecificName(body)) {
      Alert.alert(
        'Skip the name?',
        'We try not to use real names here, even when the request is positive. Try "my brother" or "a friend" instead — God knows who you mean.',
        [
          { text: 'Edit', style: 'cancel' },
          { text: 'Post anyway', onPress: submitNow },
        ],
      );
      return;
    }
    void submitNow();
  };

  const charsLeft = MAX_BODY - text.length;
  const previewName = isAnonymous
    ? 'Anonymous'
    : displayInitial(user?.first_name, user?.last_name);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>Share a prayer request</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} disabled={isSubmitting}>
              <Ionicons name="close" size={24} color={colors.iconSecondary} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                borderColor: colors.inputBorder,
              },
            ]}
            value={text}
            onChangeText={setText}
            placeholder="What can your community pray for? (Skip real names.)"
            placeholderTextColor={colors.inputPlaceholder}
            multiline
            maxLength={MAX_BODY}
            editable={!isSubmitting}
          />
          <View style={styles.metaRow}>
            <Text style={[styles.hint, { color: colors.textTertiary }]}>
              Try not to use real names — "my brother" or "a friend" is best.
            </Text>
            <Text style={[styles.charCount, { color: colors.textTertiary }]}>
              {charsLeft} left
            </Text>
          </View>

          <View style={styles.anonRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.anonTitle, { color: colors.text }]}>Post anonymously</Text>
              <Text style={[styles.anonHint, { color: colors.textTertiary }]}>
                Shown as: {previewName}
              </Text>
            </View>
            <Switch
              value={isAnonymous}
              onValueChange={setIsAnonymous}
              disabled={isSubmitting}
            />
          </View>

          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: primaryColor },
              (isSubmitting || text.trim().length === 0) && { opacity: 0.5 },
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting || text.trim().length === 0}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitText}>Post Prayer</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  hint: {
    fontSize: 12,
    flex: 1,
    paddingRight: 8,
  },
  charCount: {
    fontSize: 12,
    textAlign: 'right',
  },
  anonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 16,
  },
  anonTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  anonHint: {
    fontSize: 13,
    marginTop: 2,
  },
  submitButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
