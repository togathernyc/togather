import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

function LegalScreen() {
  const router = useRouter();

  const legalPages = [
    { title: 'Privacy Policy', route: '/legal/privacy' },
    { title: 'Terms of Service', route: '/legal/terms' },
    { title: 'Policies', route: '/legal/policies' },
    { title: 'Copyright', route: '/legal/copyright' },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Legal</Text>
        
        {legalPages.map((page) => (
          <TouchableOpacity
            key={page.route}
            style={styles.linkItem}
            onPress={() => router.push(page.route as any)}
          >
            <Text style={styles.linkText}>{page.title}</Text>
            <Text style={styles.linkArrow}>›</Text>
          </TouchableOpacity>
        ))}
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
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 32,
  },
  linkItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  linkText: {
    fontSize: 18,
    color: '#333',
  },
  linkArrow: {
    fontSize: 24,
    color: '#999',
  },
});

export default LegalScreen;

