import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

function CopyrightScreen() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Copyright</Text>
        
        <View style={styles.section}>
          <Text style={styles.bodyText}>
            © {new Date().getFullYear()} Togather. All rights reserved.
          </Text>
          <Text style={styles.bodyText}>
            All content, including but not limited to text, graphics, logos, and software, 
            is the property of Togather and is protected by copyright laws.
          </Text>
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
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 32,
  },
  section: {
    marginBottom: 32,
  },
  bodyText: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
    marginBottom: 16,
  },
});

export default CopyrightScreen;

