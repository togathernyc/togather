import React from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

function CommunityGuidelinesScreen() {
  const router = useRouter();

  const openLink = (url: string) => {
    Linking.openURL(url);
  };

  const handleTermsPress = () => {
    router.push('/(landing)/legal/terms');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Community Guidelines</Text>
        <Text style={styles.lastUpdated}>Last updated: January 3, 2026</Text>

        <View style={styles.introSection}>
          <Text style={styles.introText}>
            Togather is built on trust, respect, and genuine connection. These guidelines help
            maintain a safe and welcoming environment for all community members. Please read
            them carefully and follow them in all your interactions.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Be Respectful</Text>
          <Text style={styles.bodyText}>
            Treat everyone with kindness and respect. We're a diverse community with people
            from different backgrounds, beliefs, and perspectives.
            {'\n\n'}
            • Use welcoming and inclusive language
            {'\n'}• Be considerate of others' viewpoints
            {'\n'}• Accept constructive feedback gracefully
            {'\n'}• Remember there's a real person behind every screen
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Keep It Safe</Text>
          <Text style={styles.bodyText}>
            Everyone should feel safe using Togather. We strictly prohibit:
            {'\n\n'}
            • <Text style={styles.bold}>Harassment</Text>: No bullying, threats, or intimidation
            {'\n'}• <Text style={styles.bold}>Hate speech</Text>: No discrimination or hateful content
            {'\n'}• <Text style={styles.bold}>Violence</Text>: No violent content or threats
            {'\n'}• <Text style={styles.bold}>Sexual content</Text>: No explicit or inappropriate material
            {'\n'}• <Text style={styles.bold}>Harmful behavior</Text>: No content promoting self-harm or dangerous activities
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Be Authentic</Text>
          <Text style={styles.bodyText}>
            Honest, genuine connections are at the heart of our community.
            {'\n\n'}
            • Use your real name and photo
            {'\n'}• Don't impersonate others
            {'\n'}• Share truthful information
            {'\n'}• Don't create fake accounts
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Protect Privacy</Text>
          <Text style={styles.bodyText}>
            Respect the privacy of others in the community.
            {'\n\n'}
            • Don't share others' personal information without consent
            {'\n'}• Keep private conversations private
            {'\n'}• Be mindful of what you share in group settings
            {'\n'}• Don't screenshot or share content without permission
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>No Spam or Solicitation</Text>
          <Text style={styles.bodyText}>
            Keep conversations genuine and on-topic.
            {'\n\n'}
            • No unsolicited advertising or promotions
            {'\n'}• No repetitive or spam messages
            {'\n'}• No phishing or scam attempts
            {'\n'}• No MLM or pyramid scheme promotion
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Report Violations</Text>
          <Text style={styles.bodyText}>
            Help us keep the community safe by reporting violations.
            {'\n\n'}
            <Text style={styles.bold}>How to report:</Text>
            {'\n'}• Long-press on any message to see the "Report Message" option
            {'\n'}• Use "Block User" to immediately stop seeing content from someone
            {'\n'}• Contact support for serious concerns
            {'\n\n'}
            <Text style={styles.bold}>What happens when you report:</Text>
            {'\n'}• Our team reviews all reports within 24 hours
            {'\n'}• We take appropriate action based on the severity
            {'\n'}• The reported user is not notified who reported them
            {'\n'}• Blocking a user immediately removes their content from your view
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Consequences</Text>
          <Text style={styles.bodyText}>
            Violating these guidelines may result in:
            {'\n\n'}
            • Warning or content removal
            {'\n'}• Temporary account suspension
            {'\n'}• Permanent account termination
            {'\n'}• Reporting to law enforcement (for illegal activity)
            {'\n\n'}
            Severe violations or repeated offenses will result in immediate and permanent removal
            from the community.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Questions?</Text>
          <Text style={styles.bodyText}>
            If you have questions about these guidelines or need to report a serious concern,
            please contact us:
          </Text>
          <TouchableOpacity onPress={() => openLink('mailto:togather@supa.media')}>
            <Text style={styles.link}>togather@supa.media</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <View style={styles.footerTextContainer}>
            <Text style={styles.footerText}>
              By using Togather, you agree to follow these Community Guidelines and our{' '}
            </Text>
            <TouchableOpacity onPress={handleTermsPress}>
              <Text style={styles.footerLink}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.footerText}>.</Text>
          </View>
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
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  lastUpdated: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  introSection: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 12,
    marginBottom: 28,
  },
  introText: {
    fontSize: 16,
    color: '#444',
    lineHeight: 24,
    fontStyle: 'italic',
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
  footer: {
    marginTop: 16,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  footerTextContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 22,
  },
  footerLink: {
    fontSize: 14,
    lineHeight: 22,
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
});

export default CommunityGuidelinesScreen;
