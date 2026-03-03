import React from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  SectionList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Group } from '@features/groups/types';
import { GroupSearchItem } from '@features/groups/components/GroupSearchItem';
import { COLORS } from '../constants';

interface ExploreListViewProps {
  groups: Group[];
  groupsWithLocation: Group[];
  groupsWithoutLocation: Group[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onGroupSelect: (group: Group) => void;
  isLoading?: boolean;
}

interface Section {
  title: string;
  data: Group[];
}

export function ExploreListView({
  groups,
  groupsWithLocation,
  groupsWithoutLocation,
  searchQuery,
  onSearchChange,
  onGroupSelect,
  isLoading,
}: ExploreListViewProps) {
  // Filter groups based on search query
  const filterGroups = (groupList: Group[]) => {
    if (!searchQuery.trim()) return groupList;

    const query = searchQuery.toLowerCase();
    return groupList.filter((group) => {
      const name = (group.title || group.name || '').toLowerCase();
      const location = (group.location || group.city || '').toLowerCase();
      return name.includes(query) || location.includes(query);
    });
  };

  const filteredWithLocation = filterGroups(groupsWithLocation);
  const filteredWithoutLocation = filterGroups(groupsWithoutLocation);

  // Build sections for SectionList
  const sections: Section[] = [];

  if (filteredWithLocation.length > 0) {
    sections.push({
      title: `NEARBY GROUPS (${filteredWithLocation.length})`,
      data: filteredWithLocation,
    });
  }

  if (filteredWithoutLocation.length > 0) {
    sections.push({
      title: `ONLINE GROUPS & TEAMS (${filteredWithoutLocation.length})`,
      data: filteredWithoutLocation,
    });
  }

  const renderSectionHeader = ({ section }: { section: Section }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
    </View>
  );

  const renderItem = ({ item }: { item: Group }) => (
    <GroupSearchItem group={item} />
  );

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.emptyText}>Loading groups...</Text>
        </View>
      );
    }

    if (searchQuery.trim()) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>No groups found</Text>
          <Text style={styles.emptyText}>
            Try adjusting your search or filters
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="people-outline" size={48} color={COLORS.textMuted} />
        <Text style={styles.emptyTitle}>No groups available</Text>
        <Text style={styles.emptyText}>
          Check back later for new groups
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons
            name="search"
            size={20}
            color={COLORS.textMuted}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search groups by name or location..."
            placeholderTextColor={COLORS.textMuted}
            value={searchQuery}
            onChangeText={onSearchChange}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <Ionicons
              name="close-circle"
              size={20}
              color={COLORS.textMuted}
              style={styles.clearIcon}
              onPress={() => onSearchChange('')}
            />
          )}
        </View>
      </View>

      {/* Groups list with sections */}
      {sections.length > 0 ? (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : (
        renderEmpty()
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 0,
    paddingTop: 8,
    paddingBottom: 16,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
  },
  clearIcon: {
    marginLeft: 8,
  },
  listContent: {
    paddingBottom: 100,
  },
  sectionHeader: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 0,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  separator: {
    height: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
