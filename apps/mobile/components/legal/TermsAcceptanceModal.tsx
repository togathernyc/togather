import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { storage } from '@utils/storage';
import { DOMAIN_CONFIG } from '@togather/shared';
import { useTheme } from '@hooks/useTheme';

// Version of terms - increment when terms are updated to re-prompt acceptance
const CURRENT_TERMS_VERSION = '1.0';
const TERMS_ACCEPTED_KEY = 'terms_accepted_version';

interface TermsAcceptanceModalProps {
  onAccepted?: () => void;
}

export function TermsAcceptanceModal({ onAccepted }: TermsAcceptanceModalProps) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch((err) =>
      console.error('Error opening link:', err)
    );
  }, []);

  useEffect(() => {
    checkTermsAcceptance();
  }, []);

  const checkTermsAcceptance = async () => {
    try {
      const acceptedVersion = await storage.getItem(TERMS_ACCEPTED_KEY);
      if (acceptedVersion !== CURRENT_TERMS_VERSION) {
        setVisible(true);
      }
    } catch (error) {
      console.error('Error checking terms acceptance:', error);
      // If we can't check, show the modal to be safe
      setVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = useCallback(async () => {
    setAccepting(true);
    try {
      await storage.setItem(TERMS_ACCEPTED_KEY, CURRENT_TERMS_VERSION);
      setVisible(false);
      onAccepted?.();
    } catch (error) {
      console.error('Error saving terms acceptance:', error);
    } finally {
      setAccepting(false);
    }
  }, [onAccepted]);

  const handleTermsPress = () => {
    openLink(`${DOMAIN_CONFIG.appUrl}/legal/terms`);
  };

  const handlePrivacyPress = () => {
    openLink(`${DOMAIN_CONFIG.appUrl}/legal/privacy`);
  };

  const handlePoliciesPress = () => {
    openLink(`${DOMAIN_CONFIG.appUrl}/legal/policies`);
  };

  if (loading) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.container, { backgroundColor: colors.modalBackground, paddingBottom: insets.bottom + 20 }]}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
          >
            <Text style={[styles.title, { color: colors.text }]}>Terms of Service</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Please review and accept our terms to continue
            </Text>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Welcome to Togather</Text>
              <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                By using this app, you agree to abide by our Terms of Service and Community Guidelines.
                These terms help us maintain a safe and respectful environment for all community members.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>User Conduct</Text>
              <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                You agree to use Togather responsibly and respectfully. This includes:
              </Text>
              <View style={styles.bulletList}>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Treating all users with respect and courtesy</Text>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Not posting offensive, harmful, or inappropriate content</Text>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Not harassing, bullying, or threatening other users</Text>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Not sharing content that is illegal or violates others' rights</Text>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Reporting inappropriate content or behavior when you see it</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Content Guidelines</Text>
              <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                We have zero tolerance for objectionable content. Any content that is abusive,
                discriminatory, sexually explicit, violent, or otherwise inappropriate will be
                removed and may result in account suspension or termination.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Moderation</Text>
              <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                To ensure a safe community experience, we provide tools to:
              </Text>
              <View style={styles.bulletList}>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Report inappropriate messages or content</Text>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Block users who violate guidelines</Text>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Flag content for review by moderators</Text>
              </View>
              <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                Our team reviews all reports within 24 hours and takes appropriate action,
                which may include content removal and user suspension.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Privacy</Text>
              <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                Your privacy matters to us. We collect and use your data as described in our Privacy Policy.
                By accepting these terms, you also acknowledge our privacy practices.
              </Text>
            </View>

            <View style={styles.linksSection}>
              <TouchableOpacity onPress={handleTermsPress}>
                <Text style={[styles.link, { color: colors.link }]}>Read Full Terms of Service</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handlePrivacyPress}>
                <Text style={[styles.link, { color: colors.link }]}>Read Privacy Policy</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handlePoliciesPress}>
                <Text style={[styles.link, { color: colors.link }]}>Read Community Guidelines</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          <View style={[styles.buttonContainer, { borderTopColor: colors.border, backgroundColor: colors.modalBackground }]}>
            <TouchableOpacity
              style={[styles.acceptButton, { backgroundColor: colors.link }, accepting && styles.acceptButtonDisabled]}
              onPress={handleAccept}
              disabled={accepting}
            >
              {accepting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.acceptButtonText}>I Accept</Text>
              )}
            </TouchableOpacity>
            <Text style={[styles.acceptNote, { color: colors.textTertiary }]}>
              By tapping "I Accept", you agree to our Terms of Service, Privacy Policy, and Community Guidelines.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    borderRadius: 20,
    width: '92%',
    maxWidth: 500,
    maxHeight: '90%',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0px 10px 40px rgba(0, 0, 0, 0.2)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 40,
        elevation: 10,
      },
    }),
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
  },
  bulletList: {
    marginTop: 8,
    marginLeft: 8,
  },
  bulletItem: {
    fontSize: 15,
    lineHeight: 24,
  },
  linksSection: {
    marginTop: 8,
    marginBottom: 16,
    gap: 12,
  },
  link: {
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  buttonContainer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  acceptButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  acceptButtonDisabled: {
    opacity: 0.7,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  acceptNote: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
