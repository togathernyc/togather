import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, TouchableOpacity, Platform } from 'react-native';

const LAST_UPDATED = 'December 28, 2024';
const CONTACT_EMAIL = 'togather@supa.media';

function PrivacyPolicyScreen() {
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

  const handleEmailPress = () => {
    Linking.openURL(`mailto:${CONTACT_EMAIL}`);
  };

  return (
    <ScrollView ref={scrollViewRef} style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.lastUpdated}>Last updated: {LAST_UPDATED}</Text>

        <Text style={styles.introText}>
          Togather ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy
          explains how we collect, use, disclose, and safeguard your information when you use our
          mobile application and related services (collectively, the "Service").
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Information We Collect</Text>

          <Text style={styles.subheading}>Information You Provide</Text>
          <Text style={styles.bodyText}>
            {'\u2022'} Account information: name, email address, phone number, and profile photo{'\n'}
            {'\u2022'} Profile information: bio, interests, and preferences{'\n'}
            {'\u2022'} Group and community information: groups you create or join{'\n'}
            {'\u2022'} Communications: messages you send through our chat features{'\n'}
            {'\u2022'} Event information: RSVPs, attendance records, and event participation
          </Text>

          <Text style={styles.subheading}>Information Collected Automatically</Text>
          <Text style={styles.bodyText}>
            {'\u2022'} Device information: device type, operating system, and unique device identifiers{'\n'}
            {'\u2022'} Usage data: features used, actions taken, and time spent in the app{'\n'}
            {'\u2022'} Location data: with your permission, approximate location for finding nearby groups
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. How We Use Your Information</Text>
          <Text style={styles.bodyText}>
            We use the information we collect to:{'\n\n'}
            {'\u2022'} Provide, operate, and maintain the Service{'\n'}
            {'\u2022'} Create and manage your account{'\n'}
            {'\u2022'} Enable you to join and participate in groups and communities{'\n'}
            {'\u2022'} Facilitate communication between group members{'\n'}
            {'\u2022'} Send you notifications about group activities and events{'\n'}
            {'\u2022'} Respond to your inquiries and provide customer support{'\n'}
            {'\u2022'} Improve and personalize your experience{'\n'}
            {'\u2022'} Ensure the security and integrity of our Service{'\n'}
            {'\u2022'} Comply with legal obligations
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Information Sharing</Text>
          <Text style={styles.bodyText}>
            We may share your information in the following circumstances:{'\n\n'}
            {'\u2022'} With other group members: Your profile information and messages are visible to
            members of groups you join{'\n'}
            {'\u2022'} With group leaders: Leaders can see member information and attendance for their groups{'\n'}
            {'\u2022'} With service providers: We use third-party services (such as Stream for chat,
            Supabase for data storage) that help us operate the Service{'\n'}
            {'\u2022'} For legal reasons: When required by law or to protect our rights and safety{'\n'}
            {'\u2022'} With your consent: When you explicitly agree to share information
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. Third-Party Services</Text>
          <Text style={styles.bodyText}>
            Our Service uses third-party service providers to help us operate, including services for
            authentication, data storage, messaging, and mapping. These providers have their own
            privacy policies governing their use of your information. We only share information with
            these providers as necessary to deliver the Service to you.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>5. Data Retention</Text>
          <Text style={styles.bodyText}>
            We retain your personal information for as long as your account is active or as needed to
            provide you with the Service. You may request deletion of your account and associated data
            at any time by contacting us. Some information may be retained as required by law or for
            legitimate business purposes.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>6. Data Security</Text>
          <Text style={styles.bodyText}>
            We implement appropriate technical and organizational security measures to protect your
            personal information against unauthorized access, alteration, disclosure, or destruction.
            However, no method of transmission over the Internet or electronic storage is 100% secure,
            and we cannot guarantee absolute security.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>7. Your Rights and Choices</Text>
          <Text style={styles.bodyText}>
            You have the right to:{'\n\n'}
            {'\u2022'} Access and update your personal information through your account settings{'\n'}
            {'\u2022'} Delete your account and personal data{'\n'}
            {'\u2022'} Opt out of promotional communications{'\n'}
            {'\u2022'} Control location sharing through your device settings{'\n'}
            {'\u2022'} Request a copy of your data{'\n\n'}
            To exercise these rights, please contact us using the information below.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>8. Children's Privacy</Text>
          <Text style={styles.bodyText}>
            Our Service is not directed to children under 13 years of age. We do not knowingly collect
            personal information from children under 13. If we learn that we have collected personal
            information from a child under 13, we will take steps to delete such information promptly.
            If you believe we may have collected information from a child under 13, please contact us.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>9. International Data Transfers</Text>
          <Text style={styles.bodyText}>
            Your information may be transferred to and processed in countries other than your country
            of residence. These countries may have different data protection laws. By using our Service,
            you consent to the transfer of your information to these countries.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>10. Changes to This Privacy Policy</Text>
          <Text style={styles.bodyText}>
            We may update this Privacy Policy from time to time. We will notify you of any changes by
            posting the new Privacy Policy on this page and updating the "Last updated" date. We
            encourage you to review this Privacy Policy periodically for any changes.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>11. Contact Us</Text>
          <Text style={styles.bodyText}>
            If you have any questions about this Privacy Policy or our privacy practices, please
            contact us at:
          </Text>
          <TouchableOpacity onPress={handleEmailPress}>
            <Text style={styles.emailLink}>{CONTACT_EMAIL}</Text>
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
    paddingBottom: 60,
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
  },
  lastUpdated: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  introText: {
    fontSize: 16,
    color: '#555',
    lineHeight: 24,
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
  subheading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#444',
    marginTop: 12,
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 16,
    color: '#666',
    lineHeight: 26,
  },
  emailLink: {
    fontSize: 16,
    color: '#007AFF',
    marginTop: 8,
  },
});

export default PrivacyPolicyScreen;

