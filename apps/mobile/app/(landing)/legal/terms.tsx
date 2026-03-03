import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';

function TermsOfServiceScreen() {
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);

  // Scroll to top when component mounts (fixes auto-scroll to bottom on web)
  useEffect(() => {
    if (Platform.OS === 'web') {
      // Small delay to ensure content is rendered
      const timer = setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: 0, animated: false });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, []);

  const openLink = (url: string) => {
    Linking.openURL(url);
  };

  const handlePrivacyPress = () => {
    router.push('/(landing)/legal/privacy');
  };

  return (
    <ScrollView ref={scrollViewRef} style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.lastUpdated}>Last updated: January 3, 2026</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
          <Text style={styles.bodyText}>
            By accessing and using Togather ("the App"), you accept and agree to be bound by these
            Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the App.
            {'\n\n'}
            These Terms apply to all users, including community members, leaders, and administrators.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. User Accounts</Text>
          <Text style={styles.bodyText}>
            To use certain features of the App, you must create an account. You agree to:
            {'\n\n'}
            • Provide accurate and complete information when creating your account
            {'\n'}• Keep your account credentials secure and not share them with others
            {'\n'}• Be responsible for all activities that occur under your account
            {'\n'}• Notify us immediately of any unauthorized use of your account
            {'\n\n'}
            You must be at least 13 years old to create an account. If you are under 18, you must
            have parental or guardian consent to use the App.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. User-Generated Content</Text>
          <Text style={styles.bodyText}>
            The App allows you to post, share, and interact with content created by you and other users
            ("User Content"). You retain ownership of your User Content, but by posting it, you grant
            Togather a non-exclusive, royalty-free license to use, display, and distribute your content
            within the App.
            {'\n\n'}
            You are solely responsible for your User Content and the consequences of sharing it.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. Prohibited Content and Conduct</Text>
          <Text style={styles.bodyText}>
            <Text style={styles.bold}>We have zero tolerance for objectionable content or abusive users.</Text>
            {'\n\n'}
            You agree NOT to post, share, or engage in any of the following:
            {'\n\n'}
            • <Text style={styles.bold}>Harassment or bullying</Text>: Content that threatens, harasses,
            bullies, or intimidates any person
            {'\n\n'}• <Text style={styles.bold}>Hate speech</Text>: Content that promotes violence,
            discrimination, or hatred based on race, ethnicity, religion, gender, sexual orientation,
            disability, or any other protected characteristic
            {'\n\n'}• <Text style={styles.bold}>Sexual content</Text>: Sexually explicit, pornographic,
            or suggestive content of any kind
            {'\n\n'}• <Text style={styles.bold}>Violence</Text>: Graphic violence, gore, or content that
            promotes or glorifies violence
            {'\n\n'}• <Text style={styles.bold}>Illegal content</Text>: Content that violates any law,
            promotes illegal activities, or infringes on others' rights
            {'\n\n'}• <Text style={styles.bold}>Spam</Text>: Unsolicited advertising, promotional content,
            or repetitive messages
            {'\n\n'}• <Text style={styles.bold}>Impersonation</Text>: Pretending to be someone else or
            misrepresenting your identity
            {'\n\n'}• <Text style={styles.bold}>Harmful content</Text>: Content that could harm minors,
            promotes self-harm, or contains dangerous misinformation
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>5. Content Moderation and Reporting</Text>
          <Text style={styles.bodyText}>
            We are committed to maintaining a safe community. To achieve this:
            {'\n\n'}
            • <Text style={styles.bold}>Reporting</Text>: You can report any content or user that violates
            these Terms by using the "Report" feature in the App. Long-press any message to access the
            report option.
            {'\n\n'}• <Text style={styles.bold}>Blocking</Text>: You can block any user at any time.
            Blocked users will not be able to see your content or contact you. When you block a user,
            their content is immediately removed from your view.
            {'\n\n'}• <Text style={styles.bold}>Review Process</Text>: Our moderation team reviews all
            reports within 24 hours. Appropriate action will be taken, which may include content removal,
            warnings, temporary suspension, or permanent account termination.
            {'\n\n'}• <Text style={styles.bold}>Appeals</Text>: If you believe your content was wrongly
            removed or your account was wrongly suspended, you may contact us to appeal the decision.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>6. Enforcement Actions</Text>
          <Text style={styles.bodyText}>
            Violations of these Terms may result in:
            {'\n\n'}
            • Removal of the offending content
            {'\n'}• Temporary suspension of your account
            {'\n'}• Permanent termination of your account
            {'\n'}• Reporting to law enforcement where required by law
            {'\n\n'}
            The severity of the action depends on the nature and frequency of the violation. Repeat
            offenders and severe violations (such as illegal content or threats of violence) will
            result in immediate and permanent account termination.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>7. Intellectual Property</Text>
          <Text style={styles.bodyText}>
            The App and its original content (excluding User Content) are owned by Togather and are
            protected by copyright, trademark, and other laws. You may not copy, modify, distribute,
            or create derivative works based on our content without written permission.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>8. Privacy</Text>
          <Text style={styles.bodyText}>
            Your privacy is important to us. Please review our Privacy Policy to understand how we
            collect, use, and protect your personal information.
          </Text>
          <TouchableOpacity onPress={handlePrivacyPress}>
            <Text style={styles.link}>View Privacy Policy</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>9. Disclaimer of Warranties</Text>
          <Text style={styles.bodyText}>
            The App is provided "as is" and "as available" without warranties of any kind, either
            express or implied. We do not guarantee that the App will be uninterrupted, secure, or
            error-free.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>10. Limitation of Liability</Text>
          <Text style={styles.bodyText}>
            To the maximum extent permitted by law, Togather shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages arising out of your use of the App.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>11. Changes to Terms</Text>
          <Text style={styles.bodyText}>
            We may update these Terms from time to time. We will notify you of any material changes
            by posting the new Terms in the App and updating the "Last updated" date. Your continued
            use of the App after such changes constitutes acceptance of the new Terms.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>12. Contact Us</Text>
          <Text style={styles.bodyText}>
            If you have any questions about these Terms, please contact us at:
          </Text>
          <TouchableOpacity onPress={() => openLink('mailto:togather@supa.media')}>
            <Text style={styles.link}>togather@supa.media</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 20,
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
    paddingBottom: 60,
  },
  lastUpdated: {
    fontSize: 14,
    color: '#666',
    marginBottom: 32,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  bodyText: {
    fontSize: 16,
    color: '#555',
    lineHeight: 26,
  },
  bold: {
    fontWeight: '600',
    color: '#333',
  },
  link: {
    fontSize: 16,
    color: '#007AFF',
    textDecorationLine: 'underline',
    marginTop: 8,
  },
});

export default TermsOfServiceScreen;
